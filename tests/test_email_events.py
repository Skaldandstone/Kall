"""Phase 3: confirming a detected event must drive the exact same
move_application() path the manual drag-to-stage UI uses -- these tests
check the actual Application fields move_application sets (failure_reason,
interview_scheduled_at, submitted_at), not just a status string, since the
whole point of reusing that function is that those side effects come along
for free.
"""

from kall.models import Application, CareerProfile, EmailConnection, EmailDetectedEvent, Job
from kall.models.enums import ApplicationStatus
from sqlmodel import Session

API = "/api/me/email-events"


def _seed(engine, user_id: int, *, application_status=ApplicationStatus.SUBMITTED):
    with Session(engine) as session:
        job = Job(source="test", company="Acme", title="QA Engineer", description="...", url="https://example.com/job/1")
        session.add(job)
        profile = CareerProfile(user_id=user_id, name="Default")
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = Application(user_id=user_id, job_id=job.id, career_profile_id=profile.id, status=application_status)
        session.add(application)
        connection = EmailConnection(user_id=user_id, provider="gmail", access_token_encrypted="enc")
        session.add(connection)
        session.commit()
        session.refresh(application)
        session.refresh(connection)
        return application.id, connection.id


def _event(engine, *, user_id: int, connection_id: int, application_id: int | None, event_type: str = "rejection", status: str = "pending") -> int:
    with Session(engine) as session:
        event = EmailDetectedEvent(
            connection_id=connection_id, user_id=user_id, application_id=application_id,
            external_message_id=f"msg-{event_type}", event_type=event_type, confidence=0.8, source="rules",
            evidence={"sender": "hr@acme.com", "subject": "Update", "snippet": "..."}, status=status,
        )
        session.add(event)
        session.commit()
        session.refresh(event)
        return event.id


def test_list_pending_events(client, engine) -> None:
    application_id, connection_id = _seed(engine, client.user_id)
    _event(engine, user_id=client.user_id, connection_id=connection_id, application_id=application_id)
    response = client.get(API)
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_only_returns_the_requested_status(client, engine) -> None:
    application_id, connection_id = _seed(engine, client.user_id)
    _event(engine, user_id=client.user_id, connection_id=connection_id, application_id=application_id, status="dismissed")
    assert client.get(API).json() == []
    assert len(client.get(f"{API}?status=dismissed").json()) == 1


def test_confirming_a_rejection_sets_failure_reason_via_move_application(client, engine) -> None:
    application_id, connection_id = _seed(engine, client.user_id)
    event_id = _event(engine, user_id=client.user_id, connection_id=connection_id, application_id=application_id, event_type="rejection")

    response = client.post(f"{API}/{event_id}/confirm", json={})
    assert response.status_code == 200, response.text
    assert response.json()["stage"] == "rejected"

    with Session(engine) as session:
        application = session.get(Application, application_id)
        assert application.status == ApplicationStatus.FAILED
        assert application.failure_reason == "Rejected by employer"
        event = session.get(EmailDetectedEvent, event_id)
        assert event.status == "confirmed"
        assert event.reviewed_at is not None


def test_confirming_an_interview_sets_interview_scheduled_at(client, engine) -> None:
    application_id, connection_id = _seed(engine, client.user_id)
    event_id = _event(engine, user_id=client.user_id, connection_id=connection_id, application_id=application_id, event_type="interview")

    response = client.post(f"{API}/{event_id}/confirm", json={})
    assert response.status_code == 200

    with Session(engine) as session:
        application = session.get(Application, application_id)
        assert application.status == ApplicationStatus.SUBMITTED
        assert application.interview_scheduled_at is not None


def test_confirming_an_unmatched_event_requires_an_explicit_application_id(client, engine) -> None:
    _application_id, connection_id = _seed(engine, client.user_id)
    event_id = _event(engine, user_id=client.user_id, connection_id=connection_id, application_id=None)

    without_id = client.post(f"{API}/{event_id}/confirm", json={})
    assert without_id.status_code == 422

    with_id = client.post(f"{API}/{event_id}/confirm", json={"application_id": _application_id})
    assert with_id.status_code == 200
    with Session(engine) as session:
        event = session.get(EmailDetectedEvent, event_id)
        assert event.application_id == _application_id


def test_dismissing_an_event_never_touches_the_application(client, engine) -> None:
    application_id, connection_id = _seed(engine, client.user_id)
    event_id = _event(engine, user_id=client.user_id, connection_id=connection_id, application_id=application_id)

    response = client.post(f"{API}/{event_id}/dismiss")
    assert response.status_code == 200
    assert response.json()["status"] == "dismissed"

    with Session(engine) as session:
        application = session.get(Application, application_id)
        assert application.status == ApplicationStatus.SUBMITTED  # unchanged
        assert application.failure_reason is None


def test_confirming_an_already_reviewed_event_is_refused(client, engine) -> None:
    application_id, connection_id = _seed(engine, client.user_id)
    event_id = _event(engine, user_id=client.user_id, connection_id=connection_id, application_id=application_id, status="confirmed")
    response = client.post(f"{API}/{event_id}/confirm", json={})
    assert response.status_code == 422


def test_events_are_scoped_to_their_owner(client, engine) -> None:
    application_id, connection_id = _seed(engine, client.user_id + 1)
    event_id = _event(engine, user_id=client.user_id + 1, connection_id=connection_id, application_id=application_id)
    assert client.post(f"{API}/{event_id}/confirm", json={}).status_code == 404
    assert client.post(f"{API}/{event_id}/dismiss").status_code == 404
