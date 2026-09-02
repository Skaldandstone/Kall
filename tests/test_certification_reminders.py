"""Certification.renewal_required and reminder_days_before were writable but
nothing ever read either field -- checking "renewal required" in the
profile editor did nothing at all. queue_certification_reminders is the
missing piece.
"""

from datetime import date, datetime, timedelta

from kall.clock import utcnow
from kall.models import Certification, NotificationDelivery
from kall.services.certification_reminders import queue_certification_reminders
from sqlmodel import Session, select


def _cert(**overrides) -> Certification:
    defaults = dict(
        user_id=1,
        name="AWS Solutions Architect",
        issuing_organization="Amazon",
        renewal_required=True,
        status="active",
        reminder_days_before=90,
    )
    defaults.update(overrides)
    return Certification(**defaults)


def test_a_certification_inside_its_reminder_window_is_queued(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_cert(user_id=user_id, expires_on=today + timedelta(days=30)))
        session.commit()

        count = queue_certification_reminders(session, now=datetime.combine(today, datetime.min.time()))
        assert count == 1

        delivery = session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)).one()
        assert delivery.kind == "certification_renewal"
        assert delivery.payload["name"] == "AWS Solutions Architect"


def test_a_certification_not_yet_inside_its_reminder_window_is_left_alone(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_cert(user_id=user_id, expires_on=today + timedelta(days=200)))
        session.commit()

        assert queue_certification_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_certification_that_does_not_require_renewal_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_cert(user_id=user_id, renewal_required=False, expires_on=today + timedelta(days=1)))
        session.commit()

        assert queue_certification_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_certification_with_no_expiry_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        session.add(_cert(user_id=user_id, expires_on=None))
        session.commit()

        assert queue_certification_reminders(session, now=utcnow()) == 0


def test_renewing_a_certification_opens_up_a_fresh_reminder_for_the_next_cycle(client, engine) -> None:
    """dedupe_key is keyed to the certification's current expires_on, so
    moving expires_on forward after a renewal must not be permanently
    silenced by the first reminder ever sent for that certification id."""
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        cert = _cert(user_id=user_id, expires_on=today + timedelta(days=10))
        session.add(cert)
        session.commit()
        session.refresh(cert)
        cert_id = cert.id

        assert queue_certification_reminders(session, now=datetime.combine(today, datetime.min.time())) == 1

    with Session(engine) as session:
        cert = session.get(Certification, cert_id)
        cert.expires_on = date(2027, 6, 1)
        session.add(cert)
        session.commit()

        later = date(2027, 3, 5)  # inside the new reminder window (90 days before 2027-06-01)
        count = queue_certification_reminders(session, now=datetime.combine(later, datetime.min.time()))
        assert count == 1

        deliveries = list(session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)))
        assert len(deliveries) == 2
        assert deliveries[0].dedupe_key != deliveries[1].dedupe_key
