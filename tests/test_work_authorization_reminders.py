"""WorkAuthorization.authorized_until is collected and consumed by autofill,
but nothing anywhere ever compared it against today's date -- a visa or
sponsorship could lapse silently with no warning. The same gap already
found and fixed once for Certification.expires_on.
"""

from datetime import date, datetime, timedelta

from kall.models import NotificationDelivery, WorkAuthorization
from kall.services.work_authorization_reminders import queue_work_authorization_reminders
from sqlmodel import Session, select


def _authorization(**overrides) -> WorkAuthorization:
    defaults = dict(user_id=1, country="United States", authorization_type="H-1B")
    defaults.update(overrides)
    return WorkAuthorization(**defaults)


def test_an_authorization_inside_its_reminder_window_is_queued(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_authorization(user_id=user_id, authorized_until=today + timedelta(days=30)))
        session.commit()

        count = queue_work_authorization_reminders(session, now=datetime.combine(today, datetime.min.time()))
        assert count == 1

        delivery = session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)).one()
        assert delivery.kind == "work_authorization_reminder"
        assert delivery.payload["country"] == "United States"


def test_an_authorization_not_yet_inside_its_reminder_window_is_left_alone(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_authorization(user_id=user_id, authorized_until=today + timedelta(days=200)))
        session.commit()

        assert queue_work_authorization_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_an_authorization_with_no_expiry_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        session.add(_authorization(user_id=user_id, authorized_until=None))
        session.commit()

        assert queue_work_authorization_reminders(session, now=datetime.utcnow()) == 0


def test_renewing_an_authorization_opens_up_a_fresh_reminder_for_the_next_cycle(client, engine) -> None:
    """dedupe_key is keyed to the row's current authorized_until, so moving
    it forward after a renewal must not be permanently silenced by the
    first reminder ever sent for that row's id."""
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        authorization = _authorization(user_id=user_id, authorized_until=today + timedelta(days=10))
        session.add(authorization)
        session.commit()
        session.refresh(authorization)
        authorization_id = authorization.id

        assert queue_work_authorization_reminders(session, now=datetime.combine(today, datetime.min.time())) == 1

    with Session(engine) as session:
        authorization = session.get(WorkAuthorization, authorization_id)
        authorization.authorized_until = date(2027, 6, 1)
        session.add(authorization)
        session.commit()

        later = date(2027, 4, 2)  # inside the new reminder window (60 days before 2027-06-01)
        count = queue_work_authorization_reminders(session, now=datetime.combine(later, datetime.min.time()))
        assert count == 1

        deliveries = list(session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)))
        assert len(deliveries) == 2
        assert deliveries[0].dedupe_key != deliveries[1].dedupe_key
