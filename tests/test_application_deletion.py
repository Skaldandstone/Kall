"""Deleting an application used to raise psycopg.errors.ForeignKeyViolation
(IntegrityError) the moment any dependent row existed -- an ApplicationReview
created just by opening the review screen was enough, with no cascading
foreign keys at the DB level to clean it up automatically. Sentry:
KALL-API-1, culprit kall.api_applications.remove_application.
"""

from kall.models import (
    Application,
    ApplicationAnswer,
    ApplicationReview,
    ApplicationReviewAudit,
    ApplicationSubmission,
    ApplicationTestimonial,
    CareerProfile,
    InterviewPrep,
    Job,
    ScreeningQuestion,
    SubmissionAttempt,
    SubmissionAudit,
    SubmissionReceipt,
)
from sqlmodel import Session, select

API = "/api/me/applications"


_next_job_suffix = iter(range(1, 1000))


def _application(engine, user_id: int) -> int:
    with Session(engine) as session:
        job = Job(source="manual", company="Acme", title="Engineer", description="Build things.",
                  url=f"https://example.com/jobs/deletion-{next(_next_job_suffix)}")
        profile = CareerProfile(user_id=user_id, name="Default")
        session.add(job)
        session.add(profile)
        session.commit()
        session.refresh(job)
        session.refresh(profile)
        application = Application(user_id=user_id, job_id=job.id, career_profile_id=profile.id)
        session.add(application)
        session.commit()
        session.refresh(application)
        return application.id


def test_deleting_an_application_with_a_review_row_no_longer_violates_a_foreign_key(client, engine) -> None:
    application_id = _application(engine, client.user_id)
    # Mirrors opening the review screen: this alone used to be enough to
    # make the later delete fail.
    created = client.post(f"/api/applications/{application_id}/review")
    assert created.status_code == 200, created.text

    response = client.delete(f"{API}/{application_id}")
    assert response.status_code == 200, response.text
    assert response.json()["removed"] is True

    with Session(engine) as session:
        assert session.get(Application, application_id) is None
        assert session.exec(select(ApplicationReview).where(ApplicationReview.application_id == application_id)).first() is None


def test_deleting_an_application_cleans_up_every_dependent_table(client, engine) -> None:
    application_id = _application(engine, client.user_id)

    with Session(engine) as session:
        question = ScreeningQuestion(application_id=application_id, key="q1", prompt="Why this role?")
        session.add(question)
        session.commit()
        session.refresh(question)
        session.add(ApplicationAnswer(application_id=application_id, question_id=question.id, value="Because"))
        session.add(ApplicationReview(application_id=application_id, user_id=client.user_id))
        session.add(ApplicationReviewAudit(application_id=application_id, user_id=client.user_id, event="test"))
        session.add(InterviewPrep(user_id=client.user_id, application_id=application_id))
        session.add(ApplicationTestimonial(application_id=application_id, user_id=client.user_id, testimonial_id=1))
        submission = ApplicationSubmission(
            user_id=client.user_id, application_id=application_id, provider="test",
            preview_checksum="abc", document_checksums={},
        )
        session.add(submission)
        session.commit()
        session.refresh(submission)
        session.add(SubmissionAttempt(submission_id=submission.id, idempotency_key="key-1"))
        session.add(SubmissionReceipt(submission_id=submission.id, provider_receipt_id="r1", submitted_payload_checksum="x"))
        session.add(SubmissionAudit(submission_id=submission.id, user_id=client.user_id, event="test"))
        session.commit()
        submission_id = submission.id

    response = client.delete(f"{API}/{application_id}")
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        assert session.get(Application, application_id) is None
        assert list(session.exec(select(ScreeningQuestion).where(ScreeningQuestion.application_id == application_id))) == []
        assert list(session.exec(select(ApplicationAnswer).where(ApplicationAnswer.application_id == application_id))) == []
        assert list(session.exec(select(ApplicationReview).where(ApplicationReview.application_id == application_id))) == []
        assert list(session.exec(select(ApplicationReviewAudit).where(ApplicationReviewAudit.application_id == application_id))) == []
        assert list(session.exec(select(InterviewPrep).where(InterviewPrep.application_id == application_id))) == []
        assert list(session.exec(select(ApplicationTestimonial).where(ApplicationTestimonial.application_id == application_id))) == []
        assert list(session.exec(select(ApplicationSubmission).where(ApplicationSubmission.application_id == application_id))) == []
        assert list(session.exec(select(SubmissionAttempt).where(SubmissionAttempt.submission_id == submission_id))) == []
        assert list(session.exec(select(SubmissionReceipt).where(SubmissionReceipt.submission_id == submission_id))) == []
        assert list(session.exec(select(SubmissionAudit).where(SubmissionAudit.submission_id == submission_id))) == []


def test_deleting_an_application_does_not_touch_a_different_application(client, engine) -> None:
    keep_id = _application(engine, client.user_id)
    delete_id = _application(engine, client.user_id)
    with Session(engine) as session:
        session.add(ApplicationReview(application_id=keep_id, user_id=client.user_id))
        session.add(ApplicationReview(application_id=delete_id, user_id=client.user_id))
        session.commit()

    response = client.delete(f"{API}/{delete_id}")
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        assert session.get(Application, keep_id) is not None
        assert session.exec(select(ApplicationReview).where(ApplicationReview.application_id == keep_id)).first() is not None
