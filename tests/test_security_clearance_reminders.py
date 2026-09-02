"""SecurityClearance.expires_on is collected but nothing anywhere ever
compared it against today's date -- the same gap already found and fixed
for Certification.expires_on and WorkAuthorization.authorized_until.
"""

from datetime import date, datetime, timedelta

from kall.clock import utcnow
from kall.models import NotificationDelivery, SecurityClearance
from kall.services.security_clearance_reminders import queue_security_clearance_reminders
from sqlmodel import Session, select


def _clearance(**overrides) -> SecurityClearance:
    defaults = dict(user_id=1, country="United States", clearance_type="Top Secret", status="active")
    defaults.update(overrides)
    return SecurityClearance(**defaults)


def test_a_clearance_inside_its_reminder_window_is_queued(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_clearance(user_id=user_id, expires_on=today + timedelta(days=30)))
        session.commit()

        count = queue_security_clearance_reminders(session, now=datetime.combine(today, datetime.min.time()))
        assert count == 1

        delivery = session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)).one()
        assert delivery.kind == "security_clearance_reminder"
        assert delivery.payload["clearance_type"] == "Top Secret"


def test_a_clearance_not_yet_inside_its_reminder_window_is_left_alone(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_clearance(user_id=user_id, expires_on=today + timedelta(days=200)))
        session.commit()

        assert queue_security_clearance_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_an_expired_clearance_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_clearance(user_id=user_id, status="expired", expires_on=today + timedelta(days=1)))
        session.commit()

        assert queue_security_clearance_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_clearance_with_no_expiry_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        session.add(_clearance(user_id=user_id, expires_on=None))
        session.commit()

        assert queue_security_clearance_reminders(session, now=utcnow()) == 0


def test_renewing_a_clearance_opens_up_a_fresh_reminder_for_the_next_cycle(client, engine) -> None:
    """dedupe_key is keyed to the row's current expires_on, so moving it
    forward after a renewal must not be permanently silenced by the first
    reminder ever sent for that row's id."""
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        clearance = _clearance(user_id=user_id, expires_on=today + timedelta(days=10))
        session.add(clearance)
        session.commit()
        session.refresh(clearance)
        clearance_id = clearance.id

        assert queue_security_clearance_reminders(session, now=datetime.combine(today, datetime.min.time())) == 1

    with Session(engine) as session:
        clearance = session.get(SecurityClearance, clearance_id)
        clearance.expires_on = date(2027, 6, 1)
        session.add(clearance)
        session.commit()

        later = date(2027, 3, 5)  # inside the new reminder window (90 days before 2027-06-01)
        count = queue_security_clearance_reminders(session, now=datetime.combine(later, datetime.min.time()))
        assert count == 1

        deliveries = list(session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)))
        assert len(deliveries) == 2
        assert deliveries[0].dedupe_key != deliveries[1].dedupe_key
