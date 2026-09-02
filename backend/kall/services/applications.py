
from kall.clock import utcnow
from kall.models import Application, CareerProfile, Job, ResumeDocument, User
from kall.models.enums import ApplicationStatus
from kall.services.autofill import autofill_payload_sections
from kall.services.quota import assert_application_allowed
from kall.services.resume import extract_resume_text
from kall.services.storage import get_storage
from sqlmodel import Session


def prepare_application(
    session: Session,
    user: User,
    job: Job,
    career_profile: CareerProfile,
    resume: ResumeDocument | None,
    *,
    customize_resume: bool = True,
    generate_cover_letter: bool = True,
    application_mode: str = "assisted",
) -> Application:
    assert_application_allowed(session, user)
    storage = get_storage()
    generated_prefix = f"generated/{user.id}/{job.company}-{job.id}"

    base_text = ""
    if resume:
        base_text = resume.extracted_text or extract_resume_text(storage.read(resume.file_path), resume.mime_type)

    tailored_key: str | None = None
    if customize_resume:
        tailored_key = f"{generated_prefix}/tailored_resume.txt"
        storage.save(
            tailored_key,
            (
                f"TARGET ROLE\n{job.title} at {job.company}\n\n"
                f"BASE RESUME\n{base_text}\n\n"
                "TAILORING NOTE\nPreserve factual accuracy. Emphasize requirements present in the posting."
            ).encode(),
        )

    cover_letter_key: str | None = None
    if generate_cover_letter:
        cover_letter_key = f"{generated_prefix}/cover_letter.txt"
        storage.save(
            cover_letter_key,
            (
                f"Dear Hiring Team,\n\n"
                f"I am applying for the {job.title} role at {job.company}. "
                "This draft must be reviewed for factual accuracy and personalized before submission.\n\n"
                "Sincerely,\nCandidate"
            ).encode(),
        )

    application = Application(
        user_id=user.id,
        job_id=job.id,
        career_profile_id=career_profile.id,
        base_resume_id=resume.id if resume else None,
        customized_resume_path=tailored_key,
        cover_letter_path=cover_letter_key,
        status=ApplicationStatus.REVIEW_REQUIRED,
        prepared_payload={
            "company": job.company,
            "title": job.title,
            "job_url": job.url,
            "resume_path": tailored_key or (resume.file_path if resume else None),
            "cover_letter_path": cover_letter_key,
            "customize_resume": customize_resume,
            "generate_cover_letter": generate_cover_letter,
            "application_mode": application_mode,
            "submission_policy": "Explicit review and approval are required before any submission.",
        },
        unanswered_questions=["Confirm application-specific screening questions"],
        sensitive_fields_present=True,
    )
    session.add(application)
    session.commit()
    session.refresh(application)

    # build_preview() (services/submissions.py) reads screening_answers,
    # work_authorization, and eeo out of prepared_payload, but nothing ever
    # wrote them -- the submission preview was permanently empty on exactly
    # the fields that matter. Populate them from the same consent-filtered
    # pack the autofill panel uses, so the preview and the form the user
    # actually fills always agree.
    application.prepared_payload = {
        **application.prepared_payload,
        **autofill_payload_sections(session, user, application),
    }
    session.add(application)
    session.commit()
    session.refresh(application)
    return application


def approve_application(
    session: Session,
    application: Application,
    confirmed_sensitive_fields: bool,
    confirmed_answers: bool,
) -> Application:
    if application.sensitive_fields_present and not confirmed_sensitive_fields:
        raise ValueError("Sensitive fields require explicit confirmation")
    if application.unanswered_questions and not confirmed_answers:
        raise ValueError("Application-specific answers require explicit confirmation")
    application.status = ApplicationStatus.APPROVED
    application.user_approved_at = utcnow()
    session.add(application)
    session.commit()
    session.refresh(application)
    return application