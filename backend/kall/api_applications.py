from collections import Counter
from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import Application, Job, JobMatch, User
from kall.models.enums import ApplicationStatus
from kall.services import quota

router = APIRouter()

_STAGE_LABELS = {
    "preparing": "Preparing",
    "review": "Needs review",
    "approved": "Approved",
    "submitted": "Submitted",
    "closed": "Closed",
    "rejected": "Rejected",
}

_STAGE_STATUS = {
    "preparing": ApplicationStatus.PREPARING,
    "review": ApplicationStatus.REVIEW_REQUIRED,
    "approved": ApplicationStatus.APPROVED,
    "submitted": ApplicationStatus.SUBMITTED,
    "closed": ApplicationStatus.WITHDRAWN,
    "rejected": ApplicationStatus.FAILED,
}


def _stage(application: Application) -> str:
    if application.status == ApplicationStatus.FAILED and application.failure_reason == "Rejected by employer":
        return "rejected"
    if application.status in {ApplicationStatus.FAILED, ApplicationStatus.WITHDRAWN}:
        return "closed"
    return {
        ApplicationStatus.DISCOVERED: "preparing",
        ApplicationStatus.PREPARING: "preparing",
        ApplicationStatus.REVIEW_REQUIRED: "review",
        ApplicationStatus.APPROVED: "approved",
        ApplicationStatus.SUBMITTED: "submitted",
    }.get(application.status, "preparing")


def _iso(value: datetime | None) -> str | None:
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _owned_application(application_id: int, current_user: User, session: Session) -> Application:
    application = session.get(Application, application_id)
    if not application or application.user_id != current_user.id:
        raise HTTPException(404, "Application not found")
    return application


@router.patch("/me/applications/{application_id}/stage")
def move_application(
    application_id: int,
    stage: str = Body(embed=True),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    if stage not in _STAGE_STATUS:
        raise HTTPException(422, "Unsupported application stage")
    application = _owned_application(application_id, current_user, session)
    # A completed application is one that reaches SUBMITTED, which is what the
    # plan actually meters. Guarded on the previous status so dragging a card
    # back and forth cannot charge someone repeatedly for one application.
    becoming_submitted = (
        stage == "submitted" and application.status != ApplicationStatus.SUBMITTED
    )
    if becoming_submitted:
        quota.check(session, current_user, "applications")
    application.status = _STAGE_STATUS[stage]
    application.updated_at = datetime.now(UTC).replace(tzinfo=None)
    application.failure_reason = "Rejected by employer" if stage == "rejected" else None
    if stage == "submitted" and not application.submitted_at:
        application.submitted_at = datetime.now(UTC).replace(tzinfo=None)
    session.add(application)
    session.commit()
    if becoming_submitted:
        quota.record_completed_application(session, current_user)
    job = session.get(Job, application.job_id)
    return {"id": application.id, "stage": stage, "job_url": job.url if job else None}


@router.delete("/me/applications/{application_id}")
def remove_application(
    application_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    application = _owned_application(application_id, current_user, session)
    job = session.get(Job, application.job_id)
    session.delete(application)
    session.commit()
    return {"removed": True, "job_url": job.url if job else None}


@router.get("/me/applications")
def applications_pipeline(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    applications = list(session.exec(select(Application).where(Application.user_id == current_user.id).order_by(Application.updated_at.desc())))
    job_ids = {row.job_id for row in applications}
    jobs = {row.id: row for row in session.exec(select(Job).where(Job.id.in_(job_ids))) if row.id is not None} if job_ids else {}
    matches = list(session.exec(select(JobMatch).where(JobMatch.user_id == current_user.id)))
    match_by_job: dict[int, JobMatch] = {}
    for match in matches:
        existing = match_by_job.get(match.job_id)
        if existing is None or match.score > existing.score:
            match_by_job[match.job_id] = match

    grouped: dict[str, list[dict]] = {key: [] for key in _STAGE_LABELS}
    counts: Counter[str] = Counter()
    for application in applications:
        stage = _stage(application)
        counts[stage] += 1
        job = jobs.get(application.job_id)
        match = match_by_job.get(application.job_id)
        grouped[stage].append({
            "id": application.id,
            "status": application.status,
            "stage": stage,
            "company": job.company if job else "Unknown company",
            "role": job.title if job else "Unknown role",
            "location": job.location if job else None,
            "job_url": job.url if job else None,
            "match_score": match.score if match else None,
            "updated_at": _iso(application.updated_at),
            "submitted_at": _iso(application.submitted_at),
            "requires_review": application.status == ApplicationStatus.REVIEW_REQUIRED,
            "unanswered_question_count": len(application.unanswered_questions),
            "sensitive_fields_present": application.sensitive_fields_present,
            "failure_reason": application.failure_reason,
        })

    active_stages = {"preparing", "review", "approved", "submitted"}
    active = sum(_stage(row) in active_stages for row in applications)
    review_queue = grouped["review"]
    next_decision = review_queue[0] if review_queue else None
    best_match = max((item["match_score"] for items in grouped.values() for item in items if item["match_score"] is not None), default=None)
    return {
        "summary": {"total": len(applications), "active": active, "needs_review": counts["review"], "submitted": counts["submitted"], "best_match": best_match},
        "stages": [{"key": key, "label": label, "count": len(grouped[key]), "items": grouped[key]} for key, label in _STAGE_LABELS.items()],
        "next_decision": next_decision,
        "generated_at": datetime.now(UTC).isoformat(),
    }
