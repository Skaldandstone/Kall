"""GrowthMilestone.target_date was set by the plan generators and rendered
in the growth workspace, but nothing anywhere ever read it back for a
reminder -- the same gap already found and fixed once for
Certification.expires_on. queue_growth_milestone_reminders is the missing
piece.
"""

from datetime import date, datetime, timedelta

from kall.clock import utcnow
from kall.models import GrowthMilestone, NotificationDelivery
from kall.services.growth_milestone_reminders import queue_growth_milestone_reminders
from sqlmodel import Session, select


def _milestone(**overrides) -> GrowthMilestone:
    defaults = dict(
        user_id=1,
        growth_plan_id=1,
        sequence=1,
        phase="Foundation",
        title="Build a portfolio piece",
        description="Ship one finished environment.",
        category="portfolio",
        status="not_started",
    )
    defaults.update(overrides)
    return GrowthMilestone(**defaults)


def test_a_milestone_inside_its_reminder_window_is_queued(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_milestone(user_id=user_id, target_date=today + timedelta(days=3)))
        session.commit()

        count = queue_growth_milestone_reminders(session, now=datetime.combine(today, datetime.min.time()))
        assert count == 1

        delivery = session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)).one()
        assert delivery.kind == "growth_milestone_reminder"
        assert delivery.payload["title"] == "Build a portfolio piece"


def test_a_milestone_not_yet_inside_its_reminder_window_is_left_alone(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_milestone(user_id=user_id, target_date=today + timedelta(days=30)))
        session.commit()

        assert queue_growth_milestone_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_completed_milestone_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_milestone(user_id=user_id, status="completed", target_date=today + timedelta(days=1)))
        session.commit()

        assert queue_growth_milestone_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_milestone_with_no_target_date_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        session.add(_milestone(user_id=user_id, target_date=None))
        session.commit()

        assert queue_growth_milestone_reminders(session, now=utcnow()) == 0


def test_shifting_a_milestones_target_date_opens_up_a_fresh_reminder(client, engine) -> None:
    """dedupe_key is keyed to the milestone's current target_date, so moving
    it (a plan regeneration, a direct edit) must not be permanently silenced
    by the first reminder ever sent for that milestone id."""
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        milestone = _milestone(user_id=user_id, target_date=today + timedelta(days=3))
        session.add(milestone)
        session.commit()
        session.refresh(milestone)
        milestone_id = milestone.id

        assert queue_growth_milestone_reminders(session, now=datetime.combine(today, datetime.min.time())) == 1

    with Session(engine) as session:
        milestone = session.get(GrowthMilestone, milestone_id)
        milestone.target_date = date(2026, 9, 1)
        session.add(milestone)
        session.commit()

        later = date(2026, 8, 26)  # inside the new reminder window (7 days before 2026-09-01)
        count = queue_growth_milestone_reminders(session, now=datetime.combine(later, datetime.min.time()))
        assert count == 1

        deliveries = list(session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)))
        assert len(deliveries) == 2
        assert deliveries[0].dedupe_key != deliveries[1].dedupe_key
