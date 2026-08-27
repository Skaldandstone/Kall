from datetime import datetime

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from kall.models import Application, ApplicationReview, CareerProfile, Job, SubmissionAttempt
from kall.models.enums import ApplicationStatus
from kall.services.quota import PLAN_LIMITS
from kall.services.submissions import checksum
from sqlmodel import Session, select


def _app_paths(app) -> set[str]:
    """Return all registered route paths, including those in included sub-routers."""
    paths: set[str] = set()
    for r in app.routes:
        if isinstance(r, APIRoute):
            paths.add(r.path)
        elif hasattr(r, "include_context") and hasattr(r, "original_router"):
            prefix = r.include_context.prefix or ""
            for sub in r.original_router.routes:
                if isinstance(sub, APIRoute):
                    paths.add(prefix + sub.path)
    return paths


def test_preview_checksum_is_deterministic():
    assert checksum({"b": 2, "a": 1}) == checksum({"a": 1, "b": 2})


def test_preview_checksum_changes_with_content():
    assert checksum({"a": 1}) != checksum({"a": 2})


def test_submission_routes_registered():
    from kall.main import app
    paths = _app_paths(app)
    assert "/api/applications/{application_id}/submission-preview" in paths
    assert "/api/submissions/{submission_id}/confirm" in paths
    assert "/api/submissions/{submission_id}/attempt" in paths


def _seed_confirmed_submission(client: TestClient, engine) -> int:
    """A submission ready for /attempt: approved review, confirmed preview."""
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        job = Job(
            source="manual", company="Acme", title="Engineer", description="Build things.",
            url=f"https://example.com/{datetime.utcnow().timestamp()}",
        )
        session.add(job)
        profile = CareerProfile(user_id=user_id, name="Default")
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = Application(
            user_id=user_id, job_id=job.id, career_profile_id=profile.id,
            status=ApplicationStatus.APPROVED, ats_provider="greenhouse", user_approved_at=datetime.utcnow(),
        )
        session.add(application)
        session.commit()
        session.refresh(application)
        session.add(ApplicationReview(
            application_id=application.id, user_id=user_id, status="approved",
            documents_confirmed=True, answers_confirmed=True, attestations_confirmed=True,
            approved_at=datetime.utcnow(),
        ))
        session.commit()
        application_id = application.id

    preview = client.post(f"/api/applications/{application_id}/submission-preview")
    assert preview.status_code == 200, preview.text
    submission_id = preview.json()["id"]
    confirmed = client.post(f"/api/submissions/{submission_id}/confirm")
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "confirmed", confirmed.text
    return submission_id


def test_attempt_is_gated_by_the_applications_quota(client: TestClient, engine) -> None:
    """A connector submission draws on the same weekly 'applications' meter as
    a manual kanban move -- both are one person completing one application."""
    limit = PLAN_LIMITS["free"]["applications"].amount
    for _ in range(limit):
        submission_id = _seed_confirmed_submission(client, engine)
        response = client.post(f"/api/submissions/{submission_id}/attempt")
        assert response.status_code == 200, response.text

    submission_id = _seed_confirmed_submission(client, engine)
    over_limit = client.post(f"/api/submissions/{submission_id}/attempt")
    assert over_limit.status_code == 402


def test_replaying_an_idempotent_attempt_does_not_double_charge_quota(client: TestClient, engine) -> None:
    submission_id = _seed_confirmed_submission(client, engine)
    first = client.post(f"/api/submissions/{submission_id}/attempt")
    assert first.status_code == 200, first.text
    second = client.post(f"/api/submissions/{submission_id}/attempt")
    assert second.status_code == 200, second.text
    assert first.json()["id"] == second.json()["id"]

    with Session(engine) as session:
        attempts = session.exec(select(SubmissionAttempt)).all()
        assert len(attempts) == 1

    remaining_before_exhaustion = PLAN_LIMITS["free"]["applications"].amount - 1
    for _ in range(remaining_before_exhaustion):
        other_submission_id = _seed_confirmed_submission(client, engine)
        response = client.post(f"/api/submissions/{other_submission_id}/attempt")
        assert response.status_code == 200, response.text

    yet_another = _seed_confirmed_submission(client, engine)
    over_limit = client.post(f"/api/submissions/{yet_another}/attempt")
    assert over_limit.status_code == 402
