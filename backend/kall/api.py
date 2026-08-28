from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import (
    Application,
    CandidateProfile,
    CareerProfile,
    Job,
    JobMatch,
    ResumeDocument,
    SearchRun,
    SearchSource,
    User,
)
from kall.schemas import (
    ApproveApplicationRequest,
    IdentityProfileResponse,
    IdentityProfileUpdate,
    JobCreate,
    PrepareApplicationRequest,
    ProfessionalProfileCreate,
    ResumeMetadataUpdate,
    SearchSourceCreate,
)
from kall.security import encrypt_sensitive
from kall.services import quota
from kall.services.account_deletion import delete_account
from kall.services.admin import is_admin
from kall.services.applications import approve_application, prepare_application
from kall.services.discovery import run_discovery
from kall.services.matching import deterministic_match, is_out_of_scope
from kall.services.resume import extract_resume_text
from kall.services.storage import get_storage
from kall.services.suppression import DISCOVERY_BLOCKING_REASONS, is_suppressed, suppressed_urls

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "product": "Kall"}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    """The signed-in account, plus whether it may administer Kall.

    `is_admin` is here rather than left to the client so the domain rule lives
    in exactly one place. It only decides whether a nav link is drawn -- every
    /admin route re-checks it, so a client that sets the flag itself gains
    nothing but a link to a 404.
    """
    return {**current_user.model_dump(), "is_admin": is_admin(current_user)}


class AccountDeletionRequest(BaseModel):
    #: The account's own email, typed back rather than clicked past -- there
    #: is no password to re-enter (identity is Clerk's), so this is the
    #: equivalent friction for an action with no undo.
    confirm_email: str


@router.delete("/me", status_code=204)
def delete_my_account(
    payload: AccountDeletionRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Permanently delete the signed-in account and everything in it.

    Irreversible: see services/account_deletion.py for what "everything"
    covers and what it deliberately does not (the audit log of actions taken
    by or against this account is preserved, with the account's own
    identifying columns nulled rather than the rows removed).

    This does not revoke the Clerk session -- Clerk is the identity provider
    here, and this repository does not hold a password to check. The account
    disappears from Kall immediately; the browser's existing Clerk session
    continues until it expires on its own or is revoked at Clerk directly.
    """
    if payload.confirm_email.strip().lower() != (current_user.email or "").strip().lower():
        raise HTTPException(422, "That does not match the email on this account.")
    delete_account(session, current_user.id, reason="self_service")


@router.get("/me/identity", response_model=IdentityProfileResponse)
def get_identity(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> IdentityProfileResponse:
    profile = session.exec(select(CandidateProfile).where(CandidateProfile.user_id == current_user.id)).first()
    return IdentityProfileResponse(
        email=current_user.email,
        full_name=current_user.full_name,
        preferred_name=(profile.preferred_name if profile else None) or current_user.full_name,
        city=profile.city if profile else None,
        state_region=(profile.state_region if profile else None) or current_user.state_region,
        country=(profile.country if profile else None) or current_user.country,
        timezone=profile.timezone if profile else None,
        linkedin_url=profile.linkedin_url if profile else None,
        github_url=profile.github_url if profile else None,
        portfolio_urls=profile.portfolio_urls if profile else [],
        website_urls=profile.website_urls if profile else [],
        professional_summary=profile.professional_summary if profile else None,
    )


@router.put("/me/identity", response_model=CandidateProfile)
def update_identity(payload: IdentityProfileUpdate, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> CandidateProfile:
    profile = session.exec(select(CandidateProfile).where(CandidateProfile.user_id == current_user.id)).first() or CandidateProfile(user_id=current_user.id)
    data = payload.model_dump()
    profile.preferred_name = data["preferred_name"]
    profile.phone_encrypted = encrypt_sensitive(data["phone"])
    profile.address_encrypted = encrypt_sensitive(data["address"])
    profile.city = data["city"]
    profile.state_region = data["state_region"]
    profile.postal_code_encrypted = encrypt_sensitive(data["postal_code"])
    profile.country = data["country"]
    profile.timezone = data["timezone"]
    profile.linkedin_url = data["linkedin_url"]
    profile.github_url = data["github_url"]
    profile.portfolio_urls = data["portfolio_urls"]
    profile.website_urls = data["website_urls"]
    profile.professional_summary = data["professional_summary"]
    current_user.country = data["country"]
    current_user.state_region = data["state_region"]
    session.add(current_user)
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


@router.post("/me/professional-profiles", response_model=CareerProfile)
def create_profile(payload: ProfessionalProfileCreate, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> CareerProfile:
    row = CareerProfile(user_id=current_user.id, **payload.model_dump(mode="json"))
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/me/professional-profiles", response_model=list[CareerProfile])
def list_profiles(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[CareerProfile]:
    return list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id)))


RESUME_MAX_BYTES = 15 * 1024 * 1024
RESUME_ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


@router.post("/me/resumes", response_model=ResumeDocument)
async def upload_resume(file: UploadFile = File(...), current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> ResumeDocument:
    filename = Path(file.filename or "resume").name
    if Path(filename).suffix.lower() not in RESUME_ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Resumes must be a .pdf, .docx, or .txt file")
    data = await file.read()
    if len(data) > RESUME_MAX_BYTES:
        raise HTTPException(413, "Resume file is too large (15MB limit)")
    # Checked before the write, so a file that would not fit is never stored.
    quota.check(session, current_user, "storage_bytes", amount=len(data))
    key = f"uploads/{current_user.id}/{filename}"
    mime = file.content_type or "application/octet-stream"
    text = extract_resume_text(data, mime)
    get_storage().save(key, data)
    row = ResumeDocument(user_id=current_user.id, name=filename, file_path=key, mime_type=mime, extracted_text=text, byte_size=len(data))
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/me/resumes", response_model=list[ResumeDocument])
def list_resumes(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[ResumeDocument]:
    return list(session.exec(select(ResumeDocument).where(ResumeDocument.user_id == current_user.id)))


@router.patch("/me/resumes/{resume_id}", response_model=ResumeDocument)
def update_resume_metadata(resume_id: int, payload: ResumeMetadataUpdate, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> ResumeDocument:
    row = session.get(ResumeDocument, resume_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(404, "Resume not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    if payload.is_default:
        for other in session.exec(select(ResumeDocument).where(ResumeDocument.user_id == current_user.id)):
            if other.id != row.id:
                other.is_default = False
                session.add(other)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/me/search-sources", response_model=SearchSource)
def add_search_source(payload: SearchSourceCreate, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> SearchSource:
    if payload.provider not in {"greenhouse", "lever", "ashby"}:
        raise HTTPException(422, "Unsupported provider")
    row = SearchSource(user_id=current_user.id, **payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/me/search-sources", response_model=list[SearchSource])
def list_search_sources(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[SearchSource]:
    return list(session.exec(select(SearchSource).where(SearchSource.user_id == current_user.id)))


@router.post("/jobs", response_model=Job)
def create_job(payload: JobCreate, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> Job:
    # Jobs are shared rows with no owner column (matches and applications are
    # what belong to a user), so the sign-in requirement is the whole point of
    # the dependency -- same shape as /jobs/import-search-result.
    del current_user
    row = Job(**payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/jobs/{job_id}/match/{professional_profile_id}", response_model=JobMatch)
def match_job(job_id: int, professional_profile_id: int, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> JobMatch:
    job = session.get(Job, job_id)
    profile = session.get(CareerProfile, professional_profile_id)
    if not job or not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Job or professional profile not found")
    reason = is_out_of_scope(job, profile)
    if reason:
        raise HTTPException(422, f"Job is outside this profile's search parameters: {reason}")
    score, strengths, gaps = deterministic_match(job, profile)
    row = JobMatch(user_id=current_user.id, career_profile_id=profile.id, job_id=job.id, score=score, strengths=strengths, gaps=gaps, recommendation="apply" if score >= 75 else "review" if score >= 55 else "pass")
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/applications/prepare", response_model=Application)
def prepare(payload: PrepareApplicationRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> Application:
    job = session.get(Job, payload.job_id)
    profile = session.get(CareerProfile, payload.professional_profile_id)
    resume = session.get(ResumeDocument, payload.resume_id) if payload.resume_id else None
    if not job or not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Required record not found")
    if resume and resume.user_id != current_user.id:
        raise HTTPException(403, "Resume does not belong to user")
    return prepare_application(session, current_user, job, profile, resume)


@router.post("/applications/{application_id}/approve", response_model=Application)
def approve(application_id: int, payload: ApproveApplicationRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> Application:
    application = session.get(Application, application_id)
    if not application or application.user_id != current_user.id:
        raise HTTPException(404, "Application not found")
    try:
        return approve_application(session, application, payload.confirmed_sensitive_fields, payload.confirmed_answers)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/discovery/run/{professional_profile_id}", response_model=SearchRun)
async def discovery_run(professional_profile_id: int, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> SearchRun:
    profile = session.get(CareerProfile, professional_profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Professional profile not found")
    return await run_discovery(session, current_user, profile)


@router.get("/jobs/feed")
def jobs_feed(professional_profile_id: int, min_score: int = 0, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[dict]:
    profile = session.get(CareerProfile, professional_profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Professional profile not found")
    rows = session.exec(select(JobMatch, Job).join(Job, JobMatch.job_id == Job.id).where(JobMatch.user_id == current_user.id, JobMatch.career_profile_id == professional_profile_id, JobMatch.score >= min_score).order_by(JobMatch.score.desc())).all()
    # Marking a posting dead_link (search workspace, "not real anymore") only
    # ever blocked future ingestion (see discovery.py) -- a JobMatch created
    # before that flag existed had nothing re-checking it, so a dead posting
    # kept showing up in this feed forever.
    blocked = suppressed_urls(session, current_user.id, reasons=DISCOVERY_BLOCKING_REASONS)
    return [{"match_id": match.id, "job_id": job.id, "score": match.score, "recommendation": match.recommendation, "strengths": match.strengths, "gaps": match.gaps, "company": job.company, "title": job.title, "location": job.location, "work_type": job.work_type, "salary_min": job.salary_min, "salary_max": job.salary_max, "url": job.url, "source": job.source} for match, job in rows if not is_suppressed(job.url, blocked)]


@router.get("/discovery/runs", response_model=list[SearchRun])
def discovery_runs(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[SearchRun]:
    return list(session.exec(select(SearchRun).where(SearchRun.user_id == current_user.id).order_by(SearchRun.created_at.desc())))
