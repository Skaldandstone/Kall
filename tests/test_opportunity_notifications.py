"""Durable alert mode, consent, lease and DST behavior using disabled senders."""

from datetime import datetime, time, timedelta

import pytest
from kall.models import (
    CareerProfile,
    Job,
    NotificationDelivery,
    NotificationPreference,
    Opportunity,
    OpportunityNotificationEvent,
    User,
)
from kall.services import work_claims
from kall.services.notification_delivery import process_delivery
from kall.services.notification_timing import after_quiet_hours
from kall.services.notifications import NotConfiguredError, NotificationService
from kall.services.opportunity_notifications import prepare_deliveries, record_event
from sqlmodel import Session, select

NOW = datetime(2026, 8, 30, 9)


def setup(session):
    user = User(clerk_user_id="alerts", email="alerts@example.test", full_name="Alerts")
    session.add(user)
    session.flush()
    profile = CareerProfile(user_id=user.id, name="Default")
    pref = NotificationPreference(
        user_id=user.id, delivery_mode="immediate", minimum_match_score=60
    )
    session.add(profile)
    session.add(pref)
    session.commit()
    return user, profile, pref


def add_job(session, user, profile, number=1):
    job = Job(
        source="test",
        company="<North>",
        title="Engineer & artist",
        description="Build",
        url=f"https://example.test/{number}",
    )
    session.add(job)
    session.flush()
    opp = Opportunity(
        user_id=user.id,
        professional_profile_id=profile.id,
        job_id=job.id,
        canonical_key=str(number),
        match_score=82,
        material_fingerprint=str(number),
    )
    session.add(opp)
    session.commit()
    assert record_event(session, user.id, job.id, str(number))
    session.commit()
    return job, opp


@pytest.fixture
def sender(monkeypatch):
    sent = []
    monkeypatch.setattr(
        NotificationService, "send_email", lambda self, *a, **k: sent.append(a) or "provider-id"
    )
    return sent


def test_immediate_groups_jobs_and_preserves_more_events_in_same_cycle(engine, sender):
    with Session(engine) as session:
        user, profile, _ = setup(session)
        job, _ = add_job(session, user, profile)
        add_job(session, user, profile, 2)
        assert not record_event(session, user.id, job.id, "1")
        assert prepare_deliveries(session, now=NOW) == 1
        delivery = session.exec(select(NotificationDelivery)).one()
        assert len(delivery.payload["opportunity_ids"]) == 2
        assert process_delivery(session, delivery, now=NOW) == "sent"
        assert "&lt;North&gt;" in sender[0][2] and "&amp;" in sender[0][2]
        add_job(session, user, profile, 3)
        assert prepare_deliveries(session, now=NOW + timedelta(seconds=30)) == 0
        assert len(sender) == 1
        assert prepare_deliveries(session, now=NOW + timedelta(minutes=5)) == 1
        second = session.exec(
            select(NotificationDelivery).where(NotificationDelivery.status == "queued")
        ).one()
        assert process_delivery(session, second, now=NOW + timedelta(minutes=5)) == "sent"
        assert len(sender) == 2


def test_digest_accumulates_then_mode_change_rechecks_at_send(engine, sender):
    with Session(engine) as session:
        user, profile, pref = setup(session)
        pref.delivery_mode = "digest"
        pref.digest_hour_local = 12
        session.add(pref)
        session.commit()
        add_job(session, user, profile)
        prepare_deliveries(session, now=NOW)
        delivery = session.exec(select(NotificationDelivery)).one()
        assert process_delivery(session, delivery, now=NOW) == "queued"
        assert delivery.next_attempt_at == NOW.replace(hour=12)
        add_job(session, user, profile, 2)
        prepare_deliveries(session, now=NOW + timedelta(minutes=5))
        assert len(delivery.payload["opportunity_ids"]) == 2
        pref.delivery_mode = "immediate"
        session.add(pref)
        delivery.next_attempt_at = None
        session.add(delivery)
        session.commit()
        assert process_delivery(session, delivery, now=NOW + timedelta(minutes=5)) == "sent"
        assert delivery.kind == "opportunity_immediate" and len(sender) == 1


@pytest.mark.parametrize("change", ["pause", "exclude", "score", "optout", "ownership"])
def test_delivery_rechecks_current_eligibility(engine, sender, change):
    with Session(engine) as session:
        user, profile, pref = setup(session)
        _, opp = add_job(session, user, profile)
        prepare_deliveries(session, now=NOW)
        delivery = session.exec(select(NotificationDelivery)).one()
        if change == "pause":
            profile.is_active = False
        if change == "exclude":
            profile.exclude_keywords = ["Engineer"]
        if change == "score":
            pref.minimum_match_score = 90
        if change == "optout":
            pref.email_enabled = False
        if change == "ownership":
            other = User(clerk_user_id="other-alert-owner", email="other-alert-owner@example.test", full_name="Other")
            session.add(other)
            session.flush()
            profile.user_id = other.id
        session.add(profile)
        session.add(pref)
        session.commit()
        assert process_delivery(session, delivery, now=NOW) == "skipped"
        assert sender == []
        assert session.exec(select(OpportunityNotificationEvent)).one().status == "skipped"


def test_quiet_backlog_is_one_summary_after_quiet_hours(engine, sender):
    with Session(engine) as session:
        user, profile, pref = setup(session)
        pref.quiet_hours_start = time(22)
        pref.quiet_hours_end = time(7)
        session.add(pref)
        session.commit()
        night = NOW.replace(hour=23)
        add_job(session, user, profile)
        prepare_deliveries(session, now=night)
        delivery = session.exec(select(NotificationDelivery)).one()
        assert process_delivery(session, delivery, now=night) == "retrying"
        add_job(session, user, profile, 2)
        prepare_deliveries(session, now=night + timedelta(minutes=5))
        assert len(list(session.exec(select(NotificationDelivery)))) == 1
        assert process_delivery(session, delivery, now=NOW + timedelta(days=1)) == "sent"
        assert len(sender) == 1 and len(delivery.payload["opportunity_ids"]) == 2


@pytest.mark.parametrize(
    "now,end,expected",
    [
        (datetime(2026, 3, 8, 9, 30), time(2, 30), datetime(2026, 3, 8, 10)),
        (datetime(2026, 11, 1, 8, 15), time(2), datetime(2026, 11, 1, 10)),
    ],
)
def test_quiet_hours_follow_real_utc_across_dst(now, end, expected):
    pref = NotificationPreference(
        user_id=1, timezone="America/Los_Angeles", quiet_hours_start=time(22), quiet_hours_end=end
    )
    assert after_quiet_hours(pref, now) == expected


def test_ambiguous_send_and_expired_sending_claim_are_never_blindly_retried(engine, monkeypatch):
    calls = []

    def uncertain(*args, **kwargs):
        calls.append(1)
        raise TimeoutError("response lost")

    monkeypatch.setattr(NotificationService, "send_email", uncertain)
    with Session(engine) as session:
        user, profile, _ = setup(session)
        add_job(session, user, profile)
        prepare_deliveries(session, now=NOW)
        delivery = session.exec(select(NotificationDelivery)).one()
        assert process_delivery(session, delivery, now=NOW) == "ambiguous"
        assert process_delivery(session, delivery, now=NOW + timedelta(minutes=5)) == "ambiguous"
        assert len(calls) == 1
        delivery.status = "sending"
        delivery.claimed_until = NOW
        session.add(delivery)
        session.commit()
        assert process_delivery(session, delivery, now=NOW + timedelta(minutes=5)) == "ambiguous"
        assert len(calls) == 1


def test_competing_delivery_claim_does_not_send(engine, sender):
    with Session(engine) as session:
        user, profile, _ = setup(session)
        add_job(session, user, profile)
        prepare_deliveries(session, now=NOW)
        delivery = session.exec(select(NotificationDelivery)).one()
        token = work_claims.acquire(session, f"opportunity-user:{user.id}", NOW)
        assert process_delivery(session, delivery, now=NOW) == "busy" and not sender
        work_claims.release(session, f"opportunity-user:{user.id}", token)
        assert process_delivery(session, delivery, now=NOW) == "sent"


def test_unconfigured_sender_keeps_events_durable(engine, monkeypatch):
    def absent(*a, **k):
        raise NotConfiguredError("disabled")

    monkeypatch.setattr(NotificationService, "send_email", absent)
    with Session(engine) as session:
        user, profile, _ = setup(session)
        add_job(session, user, profile)
        prepare_deliveries(session, now=NOW)
        delivery = session.exec(select(NotificationDelivery)).one()
        assert process_delivery(session, delivery, now=NOW) == "queued"
        assert delivery.attempts == 0
        assert session.exec(select(OpportunityNotificationEvent)).one().status == "assigned"


def test_api_validates_preferences_and_clears_deferral_on_mode_change(client, engine):
    payload = {
        "delivery_mode": "immediate",
        "timezone": "America/Los_Angeles",
        "quiet_hours_start": "22:00",
        "quiet_hours_end": "07:00",
    }
    assert client.put("/api/notification-preferences", json=payload).status_code == 200
    assert client.get("/api/notification-preferences").json()["quiet_hours_start"] == "22:00:00"
    assert (
        client.put("/api/notification-preferences", json={"delivery_mode": "instant"}).status_code
        == 422
    )
    assert client.put("/api/notification-preferences", json={"timezone": "Mars"}).status_code == 422
    assert (
        client.put("/api/notification-preferences", json={"quiet_hours_start": "22:00"}).status_code
        == 422
    )
    with Session(engine) as session:
        delivery = NotificationDelivery(
            user_id=client.user_id,
            channel="email",
            kind="opportunity_digest",
            dedupe_key="later",
            next_attempt_at=NOW + timedelta(days=1),
        )
        session.add(delivery)
        session.commit()
        session.refresh(delivery)
        delivery_id = delivery.id
    assert (
        client.put("/api/notification-preferences", json={"delivery_mode": "immediate"}).status_code
        == 200
    )
    with Session(engine) as session:
        assert session.get(NotificationDelivery, delivery_id).next_attempt_at is None
