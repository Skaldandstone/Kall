from kall.models import Application, ApplicationReview
from kall.models.enums import ApplicationStatus
from kall.services.application_review import SENSITIVE_CATEGORIES, approve_review, detect_questions
from sqlmodel import Session, SQLModel, create_engine


def test_sensitive_question_detection() -> None:
    application = Application(
        user_id=1,
        job_id=1,
        career_profile_id=1,
        prepared_payload={
            "screening_questions": [
                {"key": "visa", "prompt": "Will you need sponsorship?", "category": "work_authorization"},
                {"key": "why", "prompt": "Why this role?", "category": "general"},
            ]
        },
    )
    questions = detect_questions(application)
    assert questions[0]["sensitive"] is True
    assert questions[1]["sensitive"] is False
    assert "work_authorization" in SENSITIVE_CATEGORIES


def test_string_questions_are_normalized() -> None:
    application = Application(user_id=1, job_id=1, career_profile_id=1, prepared_payload={"screening_questions": ["Why Kall?"]})
    questions = detect_questions(application)
    assert questions[0]["prompt"] == "Why Kall?"
    assert questions[0]["required"] is True


def test_approve_review_advances_application_status() -> None:
    """The pipeline's stage is derived from Application.status (see
    api_applications._stage), so approving a review must advance it there too --
    otherwise an approved application stays stuck showing "Needs review" forever."""
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        application = Application(user_id=1, job_id=1, career_profile_id=1, status=ApplicationStatus.REVIEW_REQUIRED)
        session.add(application)
        session.commit()
        session.refresh(application)
        review = ApplicationReview(
            application_id=application.id,
            user_id=1,
            documents_confirmed=True,
            answers_confirmed=True,
            sensitive_fields_confirmed=True,
            attestations_confirmed=True,
        )
        session.add(review)
        session.commit()
        session.refresh(review)

        approve_review(session, application, review)

        assert application.status == ApplicationStatus.APPROVED
        assert application.user_approved_at is not None
