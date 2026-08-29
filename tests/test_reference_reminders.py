"""Reference.last_confirmed_on and permission_to_contact are fully
CRUD-reachable but, unlike Certification/WorkAuthorization/SecurityClearance/
ProfessionalMembership, nothing ever compared last_confirmed_on against
today's date to see if a reference had gone stale.
"""

from datetime import date, datetime, timedelta

from kall.models import NotificationDelivery, Reference
from kall.services.reference_reminders import queue_reference_reminders
from sqlmodel import Session, select


def _reference(**overrides) -> Reference:
    defaults = dict(
        user_id=1, name="Ada Lovelace", relationship_description="Former manager",
        permission_to_contact=True,
    )
    defaults.update(overrides)
    return Reference(**defaults)


def test_a_reference_confirmed_within_the_window_is_left_alone(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_reference(user_id=user_id, last_confirmed_on=today - timedelta(days=30)))
        session.commit()

        assert queue_reference_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_reference_stale_since_its_last_confirmation_is_queued(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_reference(user_id=user_id, organization="Acme", last_confirmed_on=today - timedelta(days=200)))
        session.commit()

        count = queue_reference_reminders(session, now=datetime.combine(today, datetime.min.time()))
        assert count == 1

        delivery = session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)).one()
        assert delivery.kind == "reference_reminder"
        assert delivery.payload["name"] == "Ada Lovelace"
        assert delivery.payload["organization"] == "Acme"


def test_a_never_confirmed_reference_falls_back_to_its_created_date(client, engine) -> None:
    """No last_confirmed_on at all -- falls back to created_at, so a reference
    added long ago and never confirmed still eventually gets flagged."""
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        reference = _reference(user_id=user_id, last_confirmed_on=None)
        session.add(reference)
        session.commit()
        session.refresh(reference)
        reference.created_at = datetime.utcnow() - timedelta(days=400)
        session.add(reference)
        session.commit()

        assert queue_reference_reminders(session) == 1


def test_a_reference_without_permission_to_contact_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_reference(
            user_id=user_id, permission_to_contact=False, last_confirmed_on=today - timedelta(days=400),
        ))
        session.commit()

        assert queue_reference_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_a_reference_marked_unavailable_is_never_reminded(client, engine) -> None:
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        session.add(_reference(
            user_id=user_id, availability="unavailable", last_confirmed_on=today - timedelta(days=400),
        ))
        session.commit()

        assert queue_reference_reminders(session, now=datetime.combine(today, datetime.min.time())) == 0


def test_reconfirming_a_reference_opens_up_a_fresh_reminder_for_the_next_cycle(client, engine) -> None:
    """dedupe_key is keyed to the row's current last_confirmed_on, so
    updating it must not be permanently silenced by the first reminder ever
    sent for that row's id."""
    user_id = client.user_id  # type: ignore[attr-defined]
    today = date(2026, 6, 1)
    with Session(engine) as session:
        reference = _reference(user_id=user_id, last_confirmed_on=today - timedelta(days=200))
        session.add(reference)
        session.commit()
        session.refresh(reference)
        reference_id = reference.id

        assert queue_reference_reminders(session, now=datetime.combine(today, datetime.min.time())) == 1

    with Session(engine) as session:
        reference = session.get(Reference, reference_id)
        reference.last_confirmed_on = today
        session.add(reference)
        session.commit()

        later = today + timedelta(days=181)
        count = queue_reference_reminders(session, now=datetime.combine(later, datetime.min.time()))
        assert count == 1

        deliveries = list(session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user_id)))
        assert len(deliveries) == 2
        assert deliveries[0].dedupe_key != deliveries[1].dedupe_key
