from collections import Counter
from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, delete, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import (
    Application,
    ApplicationAnswer,
    ApplicationReview,
    ApplicationReviewAudit,
    ApplicationSubmission,
    ApplicationTestimonial,
    InterviewPrep,
    Job,
    JobMatch,
    JobRequirementAnalysis,
    ScreeningQuestion,
    SubmissionAttempt,
    SubmissionAudit,
    SubmissionReceipt,
    User,
)
from kall.models.enums import ApplicationStatus, SubscriptionPlan
from kall.services import quota
from kall.services.applications import application_stage
from kall.services.interview_prep import generate_interview_prep, grade_quiz_answers

router = APIRouter()

_STAGE_LABELS = {
    "preparing": "Preparing",
    "review": "Needs review",
    "approved": "Approved",
    "submitted": "Submitted",
    "interview": "Interview",
    "closed": "Closed",
    "rejected": "Rejected",
}

_STAGE_STATUS = {
    "preparing": ApplicationStatus.PREPARING,
    "review": ApplicationStatus.REVIEW_REQUIRED,
    "approved": ApplicationStatus.APPROVED,
    "submitted": ApplicationStatus.SUBMITTED,
    # No distinct ApplicationStatus exists for "interviewing" -- an interview
    # can happen any time after submission, so this stays SUBMITTED and
    # Application.interview_scheduled_at is what actually distinguishes it
    # (see move_application and _stage below).
    "interview": ApplicationStatus.SUBMITTED,
    "closed": ApplicationStatus.WITHDRAWN,
    "rejected": ApplicationStatus.FAILED,
}


def _stage(application: Application) -> str:
    return application_stage(application)


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


class InterviewPrepNotesUpdate(BaseModel):
    notes: str


class QuizAnswer(BaseModel):
    question: str = Field(max_length=1000)
    category: str = Field(max_length=120)
    answer_prompt: str = Field(max_length=2000)
    candidate_answer: str = Field(max_length=5000)


class QuizGradeRequest(BaseModel):
    answers: list[QuizAnswer] = Field(max_length=10)


def _build_prep(application: Application, current_user: User, session: Session) -> InterviewPrep:
    job = session.get(Job, application.job_id)
    analysis = session.exec(
        select(JobRequirementAnalysis).where(JobRequirementAnalysis.job_id == application.job_id)
    ).first()
    company_context: dict = {}
    question_bank: list[dict] = []
    questions_to_ask: list[dict] = []
    if job:
        # Interview prep moved entirely behind Plus (SSE-206) -- unlike the
        # AI-vs-deterministic split elsewhere, Free gets no fallback bank here.
        quota.require_plan(session, current_user, minimum=SubscriptionPlan.PLUS, feature="Interview prep")
        quota.assert_ai_allowed(session, current_user)
        prep_content, used_ai = generate_interview_prep(job, analysis)
        company_context = prep_content["company_context"]
        question_bank = prep_content["question_bank"]
        questions_to_ask = prep_content["questions_to_ask"]
        if used_ai:
            quota.record_ai_action(session, current_user)
    return InterviewPrep(
        user_id=current_user.id,
        application_id=application.id,
        questions=[item["question"] for item in question_bank],
        company_context=company_context,
        question_bank=question_bank,
        questions_to_ask=questions_to_ask,
    )


@router.get("/me/applications/{application_id}/interview-prep", response_model=InterviewPrep)
def get_interview_prep(
    application_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InterviewPrep:
    """Company context, question bank, and questions to ask for this
    application, generating it on first view.

    Generated once and stored rather than rebuilt every request -- the
    content should stay stable while someone is actually preparing with
    it, not shuffle on every page load. See /regenerate to refresh it.
    """
    application = _owned_application(application_id, current_user, session)
    prep = session.exec(select(InterviewPrep).where(InterviewPrep.application_id == application.id)).first()
    if prep:
        return prep

    prep = _build_prep(application, current_user, session)
    session.add(prep)
    session.commit()
    session.refresh(prep)
    return prep


@router.post("/me/applications/{application_id}/interview-prep/regenerate", response_model=InterviewPrep)
def regenerate_interview_prep(
    application_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InterviewPrep:
    """Replaces the company context, question bank, and questions to ask
    with a fresh AI generation. Notes are preserved -- only the generated
    content is regenerated."""
    application = _owned_application(application_id, current_user, session)
    existing = session.exec(select(InterviewPrep).where(InterviewPrep.application_id == application.id)).first()
    fresh = _build_prep(application, current_user, session)
    if existing:
        existing.company_context = fresh.company_context
        existing.question_bank = fresh.question_bank
        existing.questions_to_ask = fresh.questions_to_ask
        existing.questions = fresh.questions
        prep = existing
    else:
        prep = fresh
    session.add(prep)
    session.commit()
    session.refresh(prep)
    return prep


@router.post("/me/applications/{application_id}/interview-prep/quiz/grade")
def grade_interview_quiz(
    application_id: int,
    payload: QuizGradeRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Grades a completed practice-quiz attempt in one batched AI call.

    There is no honest deterministic score for a free-text answer, so this
    returns enabled=False (not a fabricated score) when AI is unavailable --
    the client falls back to an ungraded self-check against answer_prompt
    the same way the rest of this feature degrades without a key.
    """
    application = _owned_application(application_id, current_user, session)
    job = session.get(Job, application.job_id)
    if not job or not payload.answers:
        return {"enabled": False, "results": []}

    analysis = session.exec(
        select(JobRequirementAnalysis).where(JobRequirementAnalysis.job_id == application.job_id)
    ).first()
    quota.require_plan(session, current_user, minimum=SubscriptionPlan.PLUS, feature="Interview quiz grading")
    quota.assert_ai_allowed(session, current_user)
    results = grade_quiz_answers(job, analysis, [answer.model_dump() for answer in payload.answers])
    if results is None:
        return {"enabled": False, "results": []}
    quota.record_ai_action(session, current_user)
    return {"enabled": True, "results": results}


@router.put("/me/applications/{application_id}/interview-prep/notes", response_model=InterviewPrep)
def update_interview_prep_notes(
    application_id: int,
    payload: InterviewPrepNotesUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> InterviewPrep:
    application = _owned_application(application_id, current_user, session)
    prep = session.exec(select(InterviewPrep).where(InterviewPrep.application_id == application.id)).first()
    if not prep:
        raise HTTPException(404, "Generate the question bank before saving notes")
    prep.notes = payload.notes
    session.add(prep)
    session.commit()
    session.refresh(prep)
    return prep


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
    # Moving straight to "interview" (skipping a separate submitted drag)
    # still counts -- it implies the application was submitted.
    becoming_submitted = (
        stage in {"submitted", "interview"} and application.status != ApplicationStatus.SUBMITTED
    )
    if becoming_submitted:
        quota.check(session, current_user, "applications")
    application.status = _STAGE_STATUS[stage]
    application.updated_at = datetime.now(UTC).replace(tzinfo=None)
    application.failure_reason = "Rejected by employer" if stage == "rejected" else None
    if stage in {"submitted", "interview"} and not application.submitted_at:
        application.submitted_at = datetime.now(UTC).replace(tzinfo=None)
    if stage == "interview":
        application.interview_scheduled_at = application.interview_scheduled_at or datetime.now(UTC).replace(tzinfo=None)
    elif stage == "submitted":
        application.interview_scheduled_at = None
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

    # No cascading foreign keys exist at the DB level, so every table that
    # references application.id has to be cleared here first, in dependency
    # order, or Postgres rejects the delete with a ForeignKeyViolation --
    # exactly the error a user hit deleting an application that already had
    # an ApplicationReview row (created just by opening the review screen).
    submission_ids = list(
        session.exec(select(ApplicationSubmission.id).where(ApplicationSubmission.application_id == application_id))
    )
    if submission_ids:
        session.exec(delete(SubmissionAttempt).where(SubmissionAttempt.submission_id.in_(submission_ids)))
        session.exec(delete(SubmissionReceipt).where(SubmissionReceipt.submission_id.in_(submission_ids)))
        session.exec(delete(SubmissionAudit).where(SubmissionAudit.submission_id.in_(submission_ids)))
    session.exec(delete(ApplicationSubmission).where(ApplicationSubmission.application_id == application_id))
    session.exec(delete(ApplicationTestimonial).where(ApplicationTestimonial.application_id == application_id))
    session.exec(delete(ApplicationReviewAudit).where(ApplicationReviewAudit.application_id == application_id))
    session.exec(delete(ApplicationReview).where(ApplicationReview.application_id == application_id))
    session.exec(delete(InterviewPrep).where(InterviewPrep.application_id == application_id))
    session.exec(delete(ApplicationAnswer).where(ApplicationAnswer.application_id == application_id))
    session.exec(delete(ScreeningQuestion).where(ScreeningQuestion.application_id == application_id))
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
            "is_still_posted": job.is_still_posted if job else True,
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
