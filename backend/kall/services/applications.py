from datetime import datetime

from kall.models import (
    Application,
    CareerProfile,
    Job,
    JobRequirementAnalysis,
    ResumeDocument,
    ResumeSelection,
    User,
)
from kall.models.enums import ApplicationStatus
from kall.services.autofill import autofill_payload_sections
from kall.services.intelligence import analyze_job
from kall.services.match_intelligence import rank_resumes
from kall.services.quota import assert_application_allowed
from kall.services.tailoring import create_tailoring_proposal
from sqlmodel import Session, select


def _ensure_requirement_analysis(session: Session, job: Job) -> JobRequirementAnalysis:
    analysis = session.exec(
        select(JobRequirementAnalysis).where(JobRequirementAnalysis.job_id == job.id)
    ).first()
    if analysis:
        return analysis
    analysis = JobRequirementAnalysis(job_id=job.id, **analyze_job(f"{job.title}\n{job.description}"))
    session.add(analysis)
    session.commit()
    session.refresh(analysis)
    return analysis


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
    """Starts a real, evidence-grounded tailoring proposal for this job
    instead of writing placeholder text -- see services/tailoring.py and
    services/documents.py for the paragraph-by-paragraph review, cover
    letter drafting, and ATS-formatted PDF/DOCX rendering this now reuses.
    The application stays in REVIEW_REQUIRED until that review is done and
    documents are generated through the existing /tailoring and /documents
    endpoints; this only kicks the proposal off.
    """
    assert_application_allowed(session, user)

    tailoring_proposal_id: int | None = None
    if resume and (customize_resume or generate_cover_letter):
        analysis = _ensure_requirement_analysis(session, job)
        rank_resumes(session, user.id, job, career_profile, analysis)

        # rank_resumes recommends a resume; honor the one actually chosen on
        # the apply form instead, the same way the manual override endpoint
        # (PUT /jobs/{id}/intelligence/{profile}/selection) does.
        selection = session.exec(
            select(ResumeSelection).where(
                ResumeSelection.user_id == user.id,
                ResumeSelection.job_id == job.id,
                ResumeSelection.professional_profile_id == career_profile.id,
            )
        ).first()
        if selection and selection.selected_resume_id != resume.id:
            selection.selected_resume_id = resume.id
            selection.selection_source = "user_override"
            selection.selected_at = datetime.utcnow()
            session.add(selection)
            session.commit()

        proposal = create_tailoring_proposal(session, user.id, job, career_profile.id)
        tailoring_proposal_id = proposal.id

    application = Application(
        user_id=user.id,
        job_id=job.id,
        career_profile_id=career_profile.id,
        base_resume_id=resume.id if resume else None,
        status=ApplicationStatus.REVIEW_REQUIRED,
        prepared_payload={
            "company": job.company,
            "title": job.title,
            "job_url": job.url,
            "tailoring_proposal_id": tailoring_proposal_id,
            "cover_letter_proposal_id": None,
            "generated_document_id": None,
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
    application.user_approved_at = datetime.utcnow()
    session.add(application)
    session.commit()
    session.refresh(application)
    return application