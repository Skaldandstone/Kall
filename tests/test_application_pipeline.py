"""ApplicationStatus has no "interview" state of its own -- an interview
can happen any time after submission -- so the pipeline's "Interview" stage
is a marker (Application.interview_scheduled_at) layered on top of
SUBMITTED rather than a new status. These tests cover that it moves,
groups, and clears correctly, and that it still counts toward the
applications quota the same way submitting does.
"""

from kall.models import Application, CareerProfile, Job
from sqlmodel import Session

API = "/api/me/applications"


def _application(engine, user_id: int, **overrides) -> int:
    with Session(engine) as session:
        job = Job(source="manual", company="Acme", title="Engineer", description="Build things.",
                  url=overrides.pop("url", "https://example.com/jobs/pipeline-1"))
        profile = CareerProfile(user_id=user_id, name="Default")
        session.add(job)
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = Application(user_id=user_id, job_id=job.id, career_profile_id=profile.id, **overrides)
        session.add(application)
        session.commit()
        session.refresh(application)
        return application.id


def test_moving_to_interview_sets_the_marker_and_groups_under_interview(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    response = client.patch(f"{API}/{application_id}/stage", json={"stage": "interview"})
    assert response.status_code == 200, response.text
    assert response.json()["stage"] == "interview"

    pipeline = client.get(API).json()
    interview_stage = next(stage for stage in pipeline["stages"] if stage["key"] == "interview")
    assert any(item["id"] == application_id for item in interview_stage["items"])

    with Session(engine) as session:
        application = session.get(Application, application_id)
        assert application.interview_scheduled_at is not None
        assert application.status.value == "submitted"


def test_moving_from_interview_back_to_submitted_clears_the_marker(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    client.patch(f"{API}/{application_id}/stage", json={"stage": "interview"})
    client.patch(f"{API}/{application_id}/stage", json={"stage": "submitted"})

    with Session(engine) as session:
        application = session.get(Application, application_id)
        assert application.interview_scheduled_at is None

    pipeline = client.get(API).json()
    submitted_stage = next(stage for stage in pipeline["stages"] if stage["key"] == "submitted")
    assert any(item["id"] == application_id for item in submitted_stage["items"])


def test_moving_straight_to_interview_from_approved_still_counts_as_submitted(client, engine) -> None:
    """A person might drag straight from Approved to Interview without a
    separate Submitted step in between -- that still implies the
    application was submitted and must still meter the applications quota."""
    from kall.models import User
    from kall.models.enums import ApplicationStatus
    from kall.services.quota import snapshot

    application_id = _application(engine, client.user_id, status=ApplicationStatus.APPROVED)
    response = client.patch(f"{API}/{application_id}/stage", json={"stage": "interview"})
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        application = session.get(Application, application_id)
        assert application.submitted_at is not None
        user = session.get(User, client.user_id)
        assert snapshot(session, user)["meters"]["applications"]["used"] == 1


def test_dragging_between_submitted_and_interview_repeatedly_does_not_double_charge(client, engine) -> None:
    from kall.models import User
    from kall.services.quota import snapshot

    application_id = _application(engine, client.user_id)
    client.patch(f"{API}/{application_id}/stage", json={"stage": "submitted"})
    client.patch(f"{API}/{application_id}/stage", json={"stage": "interview"})
    client.patch(f"{API}/{application_id}/stage", json={"stage": "submitted"})
    client.patch(f"{API}/{application_id}/stage", json={"stage": "interview"})

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        assert snapshot(session, user)["meters"]["applications"]["used"] == 1
