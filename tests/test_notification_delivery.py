"""Draining the notification outbox.

The schema (NotificationDelivery, NotificationPreference, DeviceRegistration)
already existed with nothing reading it. These tests are mostly about the
resting states a row can end up in -- sent, skipped, retrying, duplicate,
failed -- since those are the actual behavior of a queue, not the happy path
alone.
"""

from datetime import datetime, time

import httpx
import pytest
from kall.models.core import Job, User
from kall.models.opportunities import (
    DeviceRegistration,
    NotificationDelivery,
    NotificationPreference,
    Opportunity,
)
from kall.security import encrypt_sensitive
from kall.services.notification_delivery import drain, process_delivery
from kall.services.notifications import NotificationService, RetryableDeliveryError
from sqlmodel import Session, select


def _user(session, email="digest@example.com"):
    user = User(clerk_user_id=f"user_{email}", email=email, full_name="Digest User")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _job_and_opportunity(session, user_id):
    job = Job(source="test", company="North", title="Engineer", description="x", url=f"https://example.com/{user_id}")
    session.add(job)
    session.commit()
    session.refresh(job)
    from kall.models.core import CareerProfile

    profile = CareerProfile(user_id=user_id, name="Default")
    session.add(profile)
    session.commit()
    session.refresh(profile)
    opportunity = Opportunity(
        user_id=user_id, professional_profile_id=profile.id, job_id=job.id,
        canonical_key="k1", match_score=82, material_fingerprint="f1",
    )
    session.add(opportunity)
    session.commit()
    session.refresh(opportunity)
    return job, opportunity


def _queued_delivery(session, user_id, opportunity_ids, **overrides):
    delivery = NotificationDelivery(
        user_id=user_id, channel=overrides.pop("channel", "email"), kind="opportunity_digest",
        dedupe_key=overrides.pop("dedupe_key", "digest:1:2026-08-27"),
        payload={"opportunity_ids": opportunity_ids},
        **overrides,
    )
    session.add(delivery)
    session.commit()
    session.refresh(delivery)
    return delivery


def test_an_unconfigured_provider_leaves_the_row_queued_not_failed(engine, monkeypatch) -> None:
    """The behaviour James asked for: wire the drain up now, pick a real
    email provider later. Nothing here should look like a failure while
    that choice is still open."""
    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        delivery = _queued_delivery(session, user.id, [opp.id])

        status = process_delivery(session, delivery, now=datetime(2026, 8, 30, 12))

        assert status == "queued"
        assert delivery.attempts == 0, "not configured must not count as a failed attempt"


def test_a_configured_provider_sends_and_marks_delivered(engine, monkeypatch) -> None:
    sent = {}

    def fake_send_email(self, recipient, subject, html, actions):
        sent.update(recipient=recipient, subject=subject, html=html)

    monkeypatch.setattr(NotificationService, "send_email", fake_send_email)

    with Session(engine) as session:
        user = _user(session)
        job, opp = _job_and_opportunity(session, user.id)
        delivery = _queued_delivery(session, user.id, [opp.id])

        status = process_delivery(session, delivery, now=datetime(2026, 8, 30, 12))

        assert status == "sent"
        assert delivery.delivered_at is not None
        assert sent["recipient"] == user.email
        assert job.title in sent["html"]
        assert job.company in sent["html"]


def test_push_delivery_uses_encrypted_registered_device(engine, monkeypatch) -> None:
    sent = {}

    def fake_post(url, **kwargs):
        sent.update(url=url, json=kwargs["json"])
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "ticket-1"}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        session.add(NotificationPreference(user_id=user.id, push_enabled=True))
        session.add(DeviceRegistration(
            user_id=user.id,
            platform="android",
            token_hash="hash",
            encrypted_token=encrypt_sensitive("ExponentPushToken[private-device-token]") or "",
        ))
        session.commit()
        delivery = _queued_delivery(
            session,
            user.id,
            [opp.id],
            dedupe_key="push:1",
            channel="push",
        )

        assert process_delivery(session, delivery, now=datetime(2026, 8, 30, 12)) == "sent"
        assert delivery.provider_message_id == "ticket-1"
        assert sent["url"] == "https://exp.host/--/api/v2/push/send"
        assert sent["json"][0]["to"] == "ExponentPushToken[private-device-token]"


def test_dead_push_token_is_disabled_and_delivery_fails(engine, monkeypatch) -> None:
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: httpx.Response(200, json={"data": [{
            "status": "error",
            "message": "Device is not registered",
            "details": {"error": "DeviceNotRegistered"},
        }]}),
    )
    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        session.add(NotificationPreference(user_id=user.id, push_enabled=True))
        registration = DeviceRegistration(
            user_id=user.id,
            platform="android",
            token_hash="dead-hash",
            encrypted_token=encrypt_sensitive("ExponentPushToken[dead-device-token]") or "",
        )
        session.add(registration)
        session.commit()
        delivery = _queued_delivery(
            session,
            user.id,
            [opp.id],
            dedupe_key="push:dead",
            channel="push",
        )

        assert process_delivery(session, delivery, now=datetime(2026, 8, 30, 12)) == "failed"
        session.refresh(registration)
        assert registration.enabled is False


def test_opting_out_skips_rather_than_sends(engine, monkeypatch) -> None:
    monkeypatch.setattr(NotificationService, "send_email", lambda *a, **k: pytest.fail("must not send"))

    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        session.add(NotificationPreference(user_id=user.id, email_enabled=False))
        session.commit()
        delivery = _queued_delivery(session, user.id, [opp.id])

        assert process_delivery(session, delivery, now=datetime(2026, 8, 30, 12)) == "skipped"


def test_quiet_hours_delay_rather_than_drop(engine, monkeypatch) -> None:
    monkeypatch.setattr(NotificationService, "send_email", lambda *a, **k: pytest.fail("must not send during quiet hours"))

    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        session.add(NotificationPreference(
            user_id=user.id, quiet_hours_start=time(22, 0), quiet_hours_end=time(7, 0),
        ))
        session.commit()
        delivery = _queued_delivery(session, user.id, [opp.id])

        status = process_delivery(session, delivery, now=datetime(2026, 8, 27, 23, 0))

        assert status == "retrying"
        assert delivery.next_attempt_at == datetime(2026, 8, 28, 7, 0)


def test_a_deleted_account_is_skipped_not_errored(engine) -> None:
    with Session(engine) as session:
        user = _user(session)
        user_id = user.id
        delivery = _queued_delivery(session, user_id, [])
        session.delete(user)
        session.commit()

        assert process_delivery(session, delivery, now=datetime(2026, 8, 30, 12)) == "skipped"


def test_a_duplicate_dedupe_key_is_not_sent_twice(engine, monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(NotificationService, "send_email", lambda self, *a, **k: calls.append(a))

    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        first = _queued_delivery(session, user.id, [opp.id], dedupe_key="digest:x:2026-08-27")
        second = _queued_delivery(session, user.id, [opp.id], dedupe_key="digest:x:2026-08-27")

        assert process_delivery(session, first, now=datetime(2026, 8, 30, 12)) == "sent"
        assert process_delivery(session, second, now=datetime(2026, 8, 30, 12)) == "duplicate"
        assert len(calls) == 1


def test_a_provider_failure_retries_with_backoff_then_gives_up(engine, monkeypatch) -> None:
    monkeypatch.setattr(
        NotificationService, "send_email",
        lambda *a, **k: (_ for _ in ()).throw(RetryableDeliveryError("SES throttled")),
    )

    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        delivery = _queued_delivery(session, user.id, [opp.id])

        now = datetime(2026, 8, 27, 9, 0)
        for expected_attempt in range(1, 5):
            status = process_delivery(session, delivery, now=now)
            assert delivery.attempts == expected_attempt
            if expected_attempt < 4:
                assert status == "retrying"
                assert delivery.next_attempt_at > now
                now = delivery.next_attempt_at
            else:
                assert status == "failed"
                assert delivery.next_attempt_at is None


def test_drain_processes_everything_due_and_leaves_the_rest(engine, monkeypatch) -> None:
    monkeypatch.setattr(NotificationService, "send_email", lambda *a, **k: None)

    with Session(engine) as session:
        user = _user(session)
        _job, opp = _job_and_opportunity(session, user.id)
        due = _queued_delivery(session, user.id, [opp.id], dedupe_key="due")
        not_due = _queued_delivery(
            session, user.id, [opp.id], dedupe_key="not-due",
            next_attempt_at=datetime(2099, 1, 1),
        )

        counts = drain(session, now=datetime(2026, 8, 27, 9, 0))

        assert counts == {"sent": 1}
        session.refresh(due)
        session.refresh(not_due)
        assert due.status == "sent"
        assert not_due.status == "queued"


def test_a_user_with_no_preference_row_gets_the_default_hour_and_timezone(engine) -> None:
    """There is no settings UI for NotificationPreference yet, so most
    accounts have no row at all -- that must mean "use the defaults",
    not "excluded", or nobody would ever get a brief."""
    from kall.services.notification_delivery import queue_daily_briefs

    with Session(engine) as session:
        _user(session)
        at_the_default_hour = datetime(2026, 8, 27, 8, 0)  # UTC, matches _DEFAULT_DIGEST_HOUR
        assert queue_daily_briefs(session, now=at_the_default_hour) == 1


def test_the_wrong_hour_queues_nothing(engine) -> None:
    from kall.services.notification_delivery import queue_daily_briefs

    with Session(engine) as session:
        _user(session)
        assert queue_daily_briefs(session, now=datetime(2026, 8, 27, 14, 0)) == 0


def test_a_preference_row_overrides_the_default_hour_and_timezone(engine) -> None:
    from kall.services.notification_delivery import queue_daily_briefs

    with Session(engine) as session:
        user = _user(session)
        # 20:00 in America/Los_Angeles (UTC-7 in August) is 03:00 UTC.
        session.add(NotificationPreference(user_id=user.id, digest_hour_local=20, timezone="America/Los_Angeles"))
        session.commit()

        assert queue_daily_briefs(session, now=datetime(2026, 8, 27, 3, 0)) == 1
        assert queue_daily_briefs(session, now=datetime(2026, 8, 27, 8, 0)) == 0, (
            "the account-wide default hour must not apply once a real preference exists"
        )


def test_opting_out_of_email_means_no_brief_is_queued_either(engine) -> None:
    from kall.services.notification_delivery import queue_daily_briefs

    with Session(engine) as session:
        user = _user(session)
        session.add(NotificationPreference(user_id=user.id, email_enabled=False))
        session.commit()

        assert queue_daily_briefs(session, now=datetime(2026, 8, 27, 8, 0)) == 0


def test_an_unresolvable_timezone_falls_back_to_utc_rather_than_crashing_the_run(engine) -> None:
    """One account's bad data must not take down everyone after it in the
    same run."""
    from kall.services.notification_delivery import queue_daily_briefs

    with Session(engine) as session:
        user = _user(session)
        session.add(NotificationPreference(user_id=user.id, timezone="Not/A_Real_Zone"))
        session.commit()

        assert queue_daily_briefs(session, now=datetime(2026, 8, 27, 8, 0)) == 1


def test_an_inactive_account_is_never_queued(engine) -> None:
    from kall.services.notification_delivery import queue_daily_briefs

    with Session(engine) as session:
        user = _user(session)
        user.is_active = False
        session.add(user)
        session.commit()

        assert queue_daily_briefs(session, now=datetime(2026, 8, 27, 8, 0)) == 0


def test_the_queued_brief_renders_from_the_same_logic_the_in_app_page_uses(engine, monkeypatch) -> None:
    """The whole reason build_morning_brief moved into its own module: this
    email must say the same thing GET /me/morning-brief would show right now,
    not a second, independently-drifting copy of that logic."""
    sent = {}
    monkeypatch.setattr(NotificationService, "send_email", lambda self, recipient, subject, html, actions: sent.update(subject=subject, html=html))

    with Session(engine) as session:
        user = _user(session)
        from kall.services.notification_delivery import queue_daily_briefs

        queue_daily_briefs(session, now=datetime(2026, 8, 27, 8, 0))
        delivery = session.exec(select(NotificationDelivery).where(NotificationDelivery.kind == "morning_brief")).one()

        process_delivery(session, delivery, now=datetime(2026, 8, 30, 12))

        from kall.services.brief import build_morning_brief
        expected = build_morning_brief(session, user)
        assert expected["focus"]["title"] in sent["subject"]
