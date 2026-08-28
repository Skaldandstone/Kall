"""ProfessionalMembership.expires_on is fully CRUD-reachable but, unlike its
siblings (Certification, WorkAuthorization, SecurityClearance), nothing
ever compared it against today's date.
"""

from datetime import date, datetime, timedelta

from kall.models import NotificationDelivery, ProfessionalMembership
from kall.services.professional_membership_reminders import queue_professional_membership_reminders
from sqlmodel import Session, select


def _membership(**overrides) -> ProfessionalMembership:
    defaults = dict(user_id=1, organization="American Bar Association", status="active")
    defaults.update(overrides)
    return ProfessionalMembership(**defaults)


def test_a_membership_inside_its_reminder_window_is_queued(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_membership(user_id=user_id, expires_on=today + timedelta(days=30)))
        session.commit()

        count = queue_professional_membership_reminders(session, now=datetime.combine(today, datetime.min.time()))
        assert count == 1

        delivery = session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)).one()
        assert delivery.kind == "professional_membership_reminder"
        assert delivery.payload["organization"] == "American Bar Association"


def test_a_membership_not_yet_inside_its_reminder_window_is_left_alone(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_membership(user_id=user_id, expires_on=today + timedelta(days=200)))
        session.commit()

        assert queue_professional_membership_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_lapsed_membership_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_membership(user_id=user_id, status="lapsed", expires_on=today + timedelta(days=1)))
        session.commit()

        assert queue_professional_membership_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_membership_with_no_expiry_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        session.add(_membership(user_id=user_id, expires_on=None))
        session.commit()

        assert queue_professional_membership_reminders(session, now=datetime.utcnow()) == 0


def test_renewing_a_membership_opens_up_a_fresh_reminder_for_the_next_cycle(client, engine) -> None:
    """dedupe_key is keyed to the row's current expires_on, so moving it
    forward after a renewal must not be permanently silenced by the first
    reminder ever sent for that row's id."""
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        membership = _membership(user_id=user_id, expires_on=today + timedelta(days=10))
        session.add(membership)
        session.commit()
        session.refresh(membership)
        membership_id = membership.id

        assert queue_professional_membership_reminders(session, now=datetime.combine(today, datetime.min.time())) == 1

    with Session(engine) as session:
        membership = session.get(ProfessionalMembership, membership_id)
        membership.expires_on = date(2027, 6, 1)
        session.add(membership)
        session.commit()

        later = date(2027, 3, 5)  # inside the new reminder window (90 days before 2027-06-01)
        count = queue_professional_membership_reminders(session, now=datetime.combine(later, datetime.min.time()))
        assert count == 1

        deliveries = list(session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)))
        assert len(deliveries) == 2
        assert deliveries[0].dedupe_key != deliveries[1].dedupe_key
