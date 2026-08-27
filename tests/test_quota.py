"""Plan limits.

The point of the rewrite these cover: applications measure what someone is
buying, and AI actions measure what Kall is spending. They are different
numbers and they move independently, so they are metered separately.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException
from kall.models.core import ResumeDocument, User
from kall.models.documents import DocumentArtifact, GeneratedDocument
from kall.models.enums import SubscriptionPlan
from kall.services import quota
from sqlmodel import Session


def make_user(session: Session, plan: str = SubscriptionPlan.FREE, suffix: str = "a") -> User:
    user = User(
        clerk_user_id=f"user_{plan}_{suffix}",
        email=f"{plan}-{suffix}@example.com",
        full_name="Test User",
        plan=plan,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_free_gets_ten_applications_then_stops(engine) -> None:
    with Session(engine) as session:
        user = make_user(session)
        for _ in range(10):
            quota.check(session, user, "applications")
            quota.consume(session, user, "applications")

        with pytest.raises(HTTPException) as exc:
            quota.check(session, user, "applications")
        assert exc.value.status_code == 402
        assert exc.value.detail["meter"] == "applications"


def test_plus_is_no_longer_unlimited(engine) -> None:
    """Plus used to be unbounded. Under the tiers it is fifty a month."""
    with Session(engine) as session:
        user = make_user(session, SubscriptionPlan.PLUS)
        quota.consume(session, user, "applications", amount=50)
        with pytest.raises(HTTPException):
            quota.check(session, user, "applications")


def test_premium_applications_are_unlimited(engine) -> None:
    with Session(engine) as session:
        user = make_user(session, SubscriptionPlan.PREMIUM)
        quota.consume(session, user, "applications", amount=5000)
        quota.check(session, user, "applications")
        assert quota.remaining(session, user, "applications") is None


def test_a_monthly_allowance_starts_fresh_in_a_new_month(engine) -> None:
    """The old counter never reset, so every user was spending a lifetime
    allowance. A monthly limit has to actually be monthly."""
    with Session(engine) as session:
        user = make_user(session, SubscriptionPlan.PLUS)
        # Spend the whole allowance in a period that is not the current one.
        last_month = quota.period_key("month", datetime(2020, 1, 15))
        session.add(
            quota.UsageCounter(user_id=user.id, meter="applications", period=last_month, used=50)
        )
        session.commit()

        # This month is untouched.
        assert quota.used(session, user, "applications") == 0
        quota.check(session, user, "applications")


def test_a_lifetime_allowance_does_not_reset(engine) -> None:
    """Free's ten are a trial, not a monthly refill -- "the first 10 are
    free" has to keep meaning that."""
    with Session(engine) as session:
        user = make_user(session)
        assert quota.limit_for(user, "applications").period == quota.LIFETIME


def test_ai_actions_are_metered_apart_from_applications(engine) -> None:
    """Someone can complete no applications and still cost real money."""
    with Session(engine) as session:
        user = make_user(session)
        for _ in range(3):
            quota.check(session, user, "ai_actions")
            quota.consume(session, user, "ai_actions")

        with pytest.raises(HTTPException) as exc:
            quota.check(session, user, "ai_actions")
        assert exc.value.detail["meter"] == "ai_actions"
        # Applications are untouched: the two meters do not borrow from each other.
        quota.check(session, user, "applications")


def test_storage_is_measured_from_the_files_that_exist(engine) -> None:
    """A gauge, not a counter: deleting a file gives the space back."""
    with Session(engine) as session:
        user = make_user(session)
        resume = ResumeDocument(
            user_id=user.id, name="cv.pdf", file_path="k", mime_type="application/pdf",
            byte_size=4 * quota.MB,
        )
        session.add(resume)
        session.commit()
        assert quota.used(session, user, "storage_bytes") == 4 * quota.MB

        session.delete(resume)
        session.commit()
        assert quota.used(session, user, "storage_bytes") == 0


def test_storage_counts_generated_documents_too(engine) -> None:
    with Session(engine) as session:
        user = make_user(session)
        document = GeneratedDocument(user_id=user.id, document_type="resume", status="ready", checksum="abc")
        session.add(document)
        session.commit()
        session.refresh(document)
        session.add(
            DocumentArtifact(
                generated_document_id=document.id, format="pdf", file_path="k",
                mime_type="application/pdf", byte_size=2 * quota.MB, checksum="x",
            )
        )
        session.commit()
        assert quota.used(session, user, "storage_bytes") == 2 * quota.MB


def test_storage_over_the_plan_is_refused(engine) -> None:
    with Session(engine) as session:
        user = make_user(session)
        session.add(
            ResumeDocument(
                user_id=user.id, name="big.pdf", file_path="k", mime_type="application/pdf",
                byte_size=25 * quota.MB,
            )
        )
        session.commit()
        with pytest.raises(HTTPException):
            quota.check(session, user, "storage_bytes", amount=1)


def test_storage_is_never_consumed(engine) -> None:
    """Calling consume on a gauge must not invent a counter for it."""
    with Session(engine) as session:
        user = make_user(session)
        quota.consume(session, user, "storage_bytes", amount=999)
        assert quota.used(session, user, "storage_bytes") == 0


def test_check_does_not_consume(engine) -> None:
    with Session(engine) as session:
        user = make_user(session)
        quota.check(session, user, "applications")
        quota.check(session, user, "applications")
        assert quota.used(session, user, "applications") == 0


def test_snapshot_reports_every_meter(engine) -> None:
    """A quota that only appears as a refusal reads as a bug."""
    with Session(engine) as session:
        user = make_user(session, SubscriptionPlan.PLUS)
        quota.consume(session, user, "applications", amount=3)

        body = quota.snapshot(session, user)
        assert body["plan"] == SubscriptionPlan.PLUS
        assert set(body["meters"]) == {"applications", "ai_actions", "storage_bytes"}
        assert body["meters"]["applications"] == {
            "used": 3, "limit": 50, "period": "month", "remaining": 47,
        }


def test_an_unknown_plan_falls_back_to_free() -> None:
    """A stray plan value must not hand out unlimited everything.

    Not persisted: `plan` is an enum column, so the database refuses an
    unknown value outright. The guard is for the window during a rolling
    deploy when a row already carries a plan the running code does not know.
    """
    user = User(email="x@example.com", full_name="X")
    user.plan = "enterprise-that-does-not-exist"
    assert quota.plan_of(user) == SubscriptionPlan.FREE
    assert quota.limit_for(user, "applications").amount == 10


def test_the_legacy_application_counter_stays_in_step(engine) -> None:
    """User.completed_application_count is still read by billing."""
    with Session(engine) as session:
        user = make_user(session)
        quota.record_completed_application(session, user)
        assert user.completed_application_count == 1
        assert quota.used(session, user, "applications") == 1
