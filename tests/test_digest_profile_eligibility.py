"""Legacy queued digests must re-check private profile constraints at delivery."""

from datetime import datetime

import pytest
from kall.models import CareerProfile, Job, NotificationDelivery, Opportunity, User
from kall.services.discovery_matching import refresh_discovered_job_match
from kall.services.notification_delivery import process_delivery
from kall.services.notifications import NotificationService
from sqlmodel import Session


@pytest.mark.parametrize("refresh_first", [False, True])
def test_excluded_historical_match_cannot_leave_through_legacy_digest(engine, monkeypatch, refresh_first):
    monkeypatch.setattr(NotificationService, "send_email", lambda *a, **k: pytest.fail("must not send"))
    with Session(engine) as session:
        user = User(email="private@example.test", full_name="Private")
        session.add(user)
        session.flush()
        profile = CareerProfile(user_id=user.id, name="Quality", target_titles=["Agency Engineer"])
        job = Job(source="test", title="Agency Engineer", company="Private", description="agency", url="https://example.test/42")
        session.add(profile)
        session.add(job)
        session.flush()
        assert refresh_discovered_job_match(session, user=user, profile=profile, job=job) is not None
        profile.exclude_keywords = ["agency"]
        session.add(profile)
        opportunity = Opportunity(user_id=user.id, professional_profile_id=profile.id, job_id=job.id,
                                  canonical_key="one", material_fingerprint="one", match_score=90)
        session.add(opportunity)
        session.flush()
        delivery = NotificationDelivery(user_id=user.id, channel="email", kind="opportunity_digest",
                                        dedupe_key="one", payload={"opportunity_ids": [opportunity.id]})
        session.add(delivery)
        session.commit()
        if refresh_first:
            refresh_discovered_job_match(session, user=user, profile=profile, job=job)
            session.commit()
        assert process_delivery(session, delivery, now=datetime(2026, 8, 30, 12)) == "skipped"
        assert delivery.attempts == 0


@pytest.mark.parametrize("invalid_profile", ["paused", "other_user", "other_opportunity_owner"])
def test_legacy_digest_cannot_use_paused_or_other_users_profile(engine, monkeypatch, invalid_profile):
    monkeypatch.setattr(NotificationService, "send_email", lambda *a, **k: pytest.fail("must not send"))
    with Session(engine) as session:
        user = User(email="owner@example.test", full_name="Owner")
        other = User(email="other@example.test", full_name="Other")
        session.add(user)
        session.add(other)
        session.flush()
        profile = CareerProfile(user_id=other.id if invalid_profile == "other_user" else user.id,
                                name="Profile", is_active=invalid_profile != "paused")
        job = Job(source="test", title="Engineer", company="Private", description="private", url="https://example.test/42")
        session.add(profile)
        session.add(job)
        session.flush()
        opportunity = Opportunity(user_id=other.id if invalid_profile == "other_opportunity_owner" else user.id,
                                  professional_profile_id=profile.id, job_id=job.id,
                                  canonical_key="one", material_fingerprint="one", match_score=90)
        session.add(opportunity)
        session.flush()
        delivery = NotificationDelivery(user_id=user.id, channel="email", kind="opportunity_digest",
                                        dedupe_key="one", payload={"opportunity_ids": [opportunity.id]})
        session.add(delivery)
        session.commit()
        assert process_delivery(session, delivery, now=datetime(2026, 8, 30, 12)) == "skipped"
