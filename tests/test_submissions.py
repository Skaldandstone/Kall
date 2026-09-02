
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from kall.clock import utcnow
from kall.models import (
    Application,
    ApplicationReview,
    ApplicationSubmission,
    CareerProfile,
    GeneratedDocument,
    Job,
    SubmissionAttempt,
)
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
            url=f"https://example.com/{utcnow().timestamp()}",
        )
        session.add(job)
        profile = CareerProfile(user_id=user_id, name="Default")
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = Application(
            user_id=user_id, job_id=job.id, career_profile_id=profile.id,
            status=ApplicationStatus.APPROVED, ats_provider="greenhouse", user_approved_at=utcnow(),
        )
        session.add(application)
        session.commit()
        session.refresh(application)
        session.add(ApplicationReview(
            application_id=application.id, user_id=user_id, status="approved",
            documents_confirmed=True, answers_confirmed=True, attestations_confirmed=True,
            approved_at=utcnow(),
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


def test_a_manual_kanban_drag_after_a_connector_attempt_does_not_double_charge(client: TestClient, engine) -> None:
    """The real-world failure mode a stuck Application.status enabled: after
    a connector attempt already charged the quota once, dragging the same
    card to "Submitted" on the kanban board must be a no-op, not a second
    charge for one real application."""
    limit = PLAN_LIMITS["free"]["applications"].amount
    submission_id = _seed_confirmed_submission(client, engine)
    attempt_response = client.post(f"/api/submissions/{submission_id}/attempt")
    assert attempt_response.status_code == 200, attempt_response.text

    with Session(engine) as session:
        application_id = session.get(ApplicationSubmission, submission_id).application_id

    drag_response = client.patch(f"/api/me/applications/{application_id}/stage", json={"stage": "submitted"})
    assert drag_response.status_code == 200, drag_response.text

    # One more full round of legitimate attempts must still fit inside the
    # weekly limit -- if the drag above had double-charged, this would 402.
    for _ in range(limit - 1):
        submission_id = _seed_confirmed_submission(client, engine)
        response = client.post(f"/api/submissions/{submission_id}/attempt")
        assert response.status_code == 200, response.text


def test_a_successful_attempt_moves_the_application_and_submission_to_submitted(client: TestClient, engine) -> None:
    """Regression test: a connector attempt created a SubmissionAttempt and
    charged the applications quota, but never advanced Application.status or
    ApplicationSubmission.status -- so the application stayed stuck on its
    pre-submission stage forever, "Create submission attempt" stayed
    clickable, and a later manual kanban drag to Submitted would have
    charged the same quota a second time for one real application.
    """
    submission_id = _seed_confirmed_submission(client, engine)
    response = client.post(f"/api/submissions/{submission_id}/attempt")
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        submission = session.get(ApplicationSubmission, submission_id)
        assert submission.status == "submitted"
        assert submission.submitted_at is not None

        application = session.get(Application, submission.application_id)
        assert application.status == ApplicationStatus.SUBMITTED
        assert application.submitted_at is not None


def test_replaying_an_attempt_after_it_already_submitted_still_works(client: TestClient, engine) -> None:
    """The "confirmed" status gate must not block a retry of the same request
    after mark_application_submitted has already moved the submission to
    "submitted" -- a client-side timeout retrying an already-succeeded
    attempt must not be told to re-confirm from scratch."""
    submission_id = _seed_confirmed_submission(client, engine)
    first = client.post(f"/api/submissions/{submission_id}/attempt")
    assert first.status_code == 200, first.text

    with Session(engine) as session:
        assert session.get(ApplicationSubmission, submission_id).status == "submitted"

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


def test_a_resume_changed_after_approval_is_caught_before_submission(client: TestClient, engine) -> None:
    """Regression test: GeneratedDocument.status never reached "finalized"
    (see services/documents.py), so build_preview()'s document_checksums was
    always {} and this exact check -- comparing what was approved against
    what currently exists -- was comparing {} to {} and could never fire.
    """
    user_id = client.user_id  # type: ignore[attr-defined]
    with Session(engine) as session:
        job = Job(
            source="manual", company="Acme", title="Engineer", description="Build things.",
            url=f"https://example.com/{utcnow().timestamp()}",
        )
        session.add(job)
        profile = CareerProfile(user_id=user_id, name="Default")
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = Application(
            user_id=user_id, job_id=job.id, career_profile_id=profile.id,
            status=ApplicationStatus.APPROVED, ats_provider="greenhouse", user_approved_at=utcnow(),
        )
        session.add(application)
        session.commit()
        session.refresh(application)
        session.add(ApplicationReview(
            application_id=application.id, user_id=user_id, status="approved",
            documents_confirmed=True, answers_confirmed=True, attestations_confirmed=True,
            approved_at=utcnow(),
        ))
        document = GeneratedDocument(
            user_id=user_id, job_id=job.id, document_type="resume",
            status="finalized", checksum="original-checksum",
        )
        session.add(document)
        session.commit()
        application_id, document_id = application.id, document.id

    preview = client.post(f"/api/applications/{application_id}/submission-preview")
    submission_id = preview.json()["id"]
    assert preview.json()["document_checksums"] == {"resume": "original-checksum"}
    confirmed = client.post(f"/api/submissions/{submission_id}/confirm")
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "confirmed"

    # The resume is regenerated (a new tailoring pass, an edit) after
    # approval -- its checksum changes, but nobody re-confirms.
    with Session(engine) as session:
        document = session.get(GeneratedDocument, document_id)
        document.checksum = "tampered-checksum"
        session.add(document)
        session.commit()

    checked = client.get(f"/api/submissions/{submission_id}")
    assert "Approved preview or documents changed" in checked.json()["validation_issues"]
