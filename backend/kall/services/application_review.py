
from kall.clock import utcnow
from kall.models import (
    Application,
    ApplicationAnswer,
    ApplicationReview,
    ApplicationReviewAudit,
    ScreeningQuestion,
)
from kall.models.enums import ApplicationStatus
from sqlmodel import Session, select

SENSITIVE_CATEGORIES = {"eeo", "work_authorization", "disability", "veteran", "demographic"}


def detect_questions(application: Application) -> list[dict]:
    raw = application.prepared_payload.get("screening_questions", [])
    questions: list[dict] = []
    for index, item in enumerate(raw):
        if isinstance(item, str):
            item = {"prompt": item}
        category = str(item.get("category", "general")).lower()
        questions.append({
            "key": str(item.get("key", f"q_{index + 1}")),
            "prompt": str(item.get("prompt", "")),
            "question_type": str(item.get("type", "text")),
            "required": bool(item.get("required", True)),
            "options": list(item.get("options", [])),
            "category": category,
            "sensitive": bool(item.get("sensitive", category in SENSITIVE_CATEGORIES)),
            "source": str(item.get("source", "ats")),
        })
    return [q for q in questions if q["prompt"]]


def build_review(session: Session, application: Application) -> ApplicationReview:
    existing = session.exec(
        select(ApplicationReview).where(ApplicationReview.application_id == application.id)
    ).first()
    if existing:
        return existing
    detected = detect_questions(application)
    for payload in detected:
        question = ScreeningQuestion(application_id=application.id, **payload)
        session.add(question)
        session.flush()
        session.add(ApplicationAnswer(application_id=application.id, question_id=question.id))
    review = ApplicationReview(application_id=application.id, user_id=application.user_id)
    session.add(review)
    session.add(ApplicationReviewAudit(application_id=application.id, user_id=application.user_id, event="review_created", details={"question_count": len(detected)}))
    session.commit()
    session.refresh(review)
    return review


def calculate_readiness(session: Session, application: Application, review: ApplicationReview) -> list[str]:
    issues: list[str] = []
    answers = list(session.exec(select(ApplicationAnswer).where(ApplicationAnswer.application_id == application.id)))
    questions = {row.id: row for row in session.exec(select(ScreeningQuestion).where(ScreeningQuestion.application_id == application.id))}
    for answer in answers:
        question = questions.get(answer.question_id)
        if question and question.required and answer.status not in {"accepted", "edited"}:
            issues.append(f"Review required: {question.prompt}")
    if not review.documents_confirmed:
        issues.append("Confirm final resume and cover letter")
    if not review.answers_confirmed:
        issues.append("Confirm screening answers")
    if any(q.sensitive for q in questions.values()) and not review.sensitive_fields_confirmed:
        issues.append("Confirm sensitive application fields")
    if not review.attestations_confirmed:
        issues.append("Confirm application attestations")
    review.readiness_issues = issues
    review.status = "ready" if not issues else "review_required"
    review.ready_at = utcnow() if not issues else None
    session.add(review)
    session.commit()
    session.refresh(review)
    return issues


def approve_review(session: Session, application: Application, review: ApplicationReview) -> ApplicationReview:
    if calculate_readiness(session, application, review):
        raise ValueError("Application review is incomplete")
    review.status = "approved"
    review.approved_at = utcnow()
    application.user_approved_at = review.approved_at
    # The pipeline's stage is derived from Application.status (see api_applications._stage),
    # so approval must advance it here -- otherwise an approved application stays stuck
    # showing "Needs review" in the pipeline forever.
    application.status = ApplicationStatus.APPROVED
    session.add(review)
    session.add(application)
    session.add(ApplicationReviewAudit(application_id=application.id, user_id=application.user_id, event="application_approved", details={"submission_allowed": False}))
    session.commit()
    session.refresh(review)
    return review
