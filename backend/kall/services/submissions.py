import hashlib
import json
from datetime import datetime, timedelta

from kall.models import (
    Application,
    ApplicationReview,
    ApplicationSubmission,
    GeneratedDocument,
    Job,
    SubmissionAttempt,
    SubmissionAudit,
)
from kall.models.enums import ApplicationStatus
from sqlmodel import Session, select

SUPPORTED_PROVIDERS = {"greenhouse", "lever", "ashby"}
APPROVAL_MAX_AGE = timedelta(minutes=30)


def checksum(payload: object) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def build_preview(session: Session, application: Application) -> tuple[dict, dict[str, str]]:
    job = session.get(Job, application.job_id)
    documents = list(session.exec(select(GeneratedDocument).where(
        GeneratedDocument.user_id == application.user_id,
        GeneratedDocument.job_id == application.job_id,
        GeneratedDocument.status == "finalized",
    )))
    document_checksums = {item.document_type: item.checksum for item in documents}
    preview = {
        "application_id": application.id,
        "job": {"company": job.company if job else None, "title": job.title if job else None, "url": job.url if job else None},
        "provider": (application.ats_provider or "manual").lower(),
        "documents": document_checksums,
        "answers": application.prepared_payload.get("screening_answers", {}),
        "work_authorization": application.prepared_payload.get("work_authorization"),
        "eeo": application.prepared_payload.get("eeo"),
        "testimonials": application.prepared_payload.get("testimonials", []),
    }
    return preview, document_checksums


def prepare_submission(session: Session, application: Application) -> ApplicationSubmission:
    existing = session.exec(select(ApplicationSubmission).where(ApplicationSubmission.application_id == application.id)).first()
    preview, document_checksums = build_preview(session, application)
    provider = (application.ats_provider or "manual").lower()
    if existing:
        existing.preview_json = preview
        existing.preview_checksum = checksum(preview)
        existing.document_checksums = document_checksums
        existing.status = "awaiting_confirmation"
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    item = ApplicationSubmission(user_id=application.user_id, application_id=application.id, provider=provider,
        status="awaiting_confirmation", preview_json=preview, preview_checksum=checksum(preview),
        document_checksums=document_checksums, approval_snapshot_at=application.user_approved_at,
        manual_url=preview["job"]["url"])
    session.add(item)
    session.flush()
    session.add(SubmissionAudit(submission_id=item.id, user_id=application.user_id, event="preview_prepared", details={"provider": provider}))
    session.commit()
    session.refresh(item)
    return item


def validate_submission(session: Session, submission: ApplicationSubmission) -> list[str]:
    issues: list[str] = []
    application = session.get(Application, submission.application_id)
    if not application or application.user_id != submission.user_id:
        return ["Application is unavailable"]
    review = session.exec(select(ApplicationReview).where(ApplicationReview.application_id == application.id)).first()
    if not review or review.status != "approved" or not application.user_approved_at:
        issues.append("Application review approval is required")
    elif datetime.utcnow() - application.user_approved_at > APPROVAL_MAX_AGE:
        issues.append("Application approval is stale")
    preview, current_checksums = build_preview(session, application)
    if checksum(preview) != submission.preview_checksum or current_checksums != submission.document_checksums:
        issues.append("Approved preview or documents changed")
    if application.unanswered_questions:
        issues.append("Required screening questions remain unanswered")
    if application.sensitive_fields_present and (not review or not review.sensitive_fields_confirmed):
        issues.append("Sensitive fields require confirmation")
    if submission.provider.lower() not in SUPPORTED_PROVIDERS:
        issues.append("Connector is unsupported; manual completion required")
    if application.prepared_payload.get("captcha_required"):
        issues.append("Manual CAPTCHA completion required")
    if application.prepared_payload.get("unsupported_required_fields"):
        issues.append("Required fields are unsupported")
    return issues


def confirm_submission(session: Session, submission: ApplicationSubmission) -> ApplicationSubmission:
    issues = validate_submission(session, submission)
    if issues:
        submission.status = "needs_manual_completion" if any("manual" in x.lower() or "unsupported" in x.lower() for x in issues) else "blocked"
        submission.failure_code = "validation_failed"
        submission.failure_detail = "; ".join(issues)
    else:
        submission.status = "confirmed"
        submission.confirmed_at = datetime.utcnow()
    session.add(submission)
    session.commit()
    session.refresh(submission)
    return submission


def find_attempt(session: Session, submission: ApplicationSubmission) -> SubmissionAttempt | None:
    """The existing attempt for this submission's current preview, if any.

    Exposed separately from create_attempt so a caller (the quota check) can
    tell a fresh attempt from an idempotent replay before creating anything.
    """
    key = checksum({"submission_id": submission.id, "preview_checksum": submission.preview_checksum})
    return session.exec(select(SubmissionAttempt).where(SubmissionAttempt.idempotency_key == key)).first()


def create_attempt(session: Session, submission: ApplicationSubmission) -> SubmissionAttempt:
    existing = find_attempt(session, submission)
    if existing:
        return existing
    key = checksum({"submission_id": submission.id, "preview_checksum": submission.preview_checksum})
    attempt = SubmissionAttempt(submission_id=submission.id, idempotency_key=key, request_json=submission.preview_json)
    session.add(attempt)
    session.commit()
    session.refresh(attempt)
    return attempt


def mark_application_submitted(session: Session, submission: ApplicationSubmission) -> None:
    """A successful connector attempt is the same "applying" event a manual
    kanban move to Submitted already is (see move_application in
    api_applications.py) -- without this, the linked Application never
    leaves its pre-submission stage. Left unfixed, that stuck card looks
    like it still needs submitting, "Create submission attempt" stays
    clickable forever (apps/web/app/applications/[id]/page.tsx disables it
    only once submission.status leaves "confirmed"), and a later manual drag
    to Submitted charges the applications quota a second time for one real
    application.
    """
    now = datetime.utcnow()
    submission.status = "submitted"
    submission.submitted_at = submission.submitted_at or now
    session.add(submission)

    application = session.get(Application, submission.application_id)
    if application and application.status != ApplicationStatus.SUBMITTED:
        application.status = ApplicationStatus.SUBMITTED
        application.submitted_at = application.submitted_at or now
        session.add(application)
    session.commit()
