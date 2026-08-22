from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from sqlmodel import Session, select

from kall.auth import (
    bearer_token,
    create_session,
    get_current_user,
    hash_secret,
    new_one_time_token,
    password_hash,
    revoke_session,
    utcnow,
    verify_password,
)
from kall.config import get_settings
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
    UserCredential,
    UserSession,
)
from kall.schemas import (
    ApproveApplicationRequest,
    AuthResponse,
    EmailVerificationConfirm,
    IdentityProfileResponse,
    IdentityProfileUpdate,
    JobCreate,
    LoginRequest,
    LogoutResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    PrepareApplicationRequest,
    ProfessionalProfileCreate,
    RegisterRequest,
    ResumeMetadataUpdate,
    SearchSourceCreate,
)
from kall.security import encrypt_sensitive
from kall.services.applications import approve_application, prepare_application
from kall.services.billing import create_checkout_url
from kall.services.discovery import run_discovery
from kall.services.matching import deterministic_match
from kall.services.resume import extract_resume_text

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "product": "Kall"}


@router.post("/auth/register", response_model=AuthResponse)
def register(payload: RegisterRequest, session: Session = Depends(get_session)) -> AuthResponse:
    email = payload.email.strip().lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "Email already registered")
    user = User(email=email, full_name=payload.full_name, country=payload.country, state_region=payload.state_region)
    session.add(user)
    session.commit()
    session.refresh(user)
    verification_token, verification_hash = new_one_time_token()
    del verification_token
    session.add(UserCredential(user_id=user.id, password_hash=password_hash(payload.password), verification_token_hash=verification_hash))
    session.add(CandidateProfile(user_id=user.id, preferred_name=payload.full_name, country=payload.country, state_region=payload.state_region))
    session.commit()
    return AuthResponse(user_id=user.id, access_token=create_session(session, user.id))


@router.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, session: Session = Depends(get_session)) -> AuthResponse:
    user = session.exec(select(User).where(User.email == payload.email.strip().lower())).first()
    if not user:
        raise HTTPException(401, "Invalid credentials")
    credential = session.exec(select(UserCredential).where(UserCredential.user_id == user.id)).first()
    if not credential:
        raise HTTPException(401, "Invalid credentials")
    if credential.locked_until and credential.locked_until > utcnow():
        raise HTTPException(423, "Account temporarily locked")
    if not verify_password(payload.password, credential.password_hash):
        credential.failed_login_count += 1
        if credential.failed_login_count >= 5:
            credential.locked_until = utcnow() + timedelta(minutes=15)
        session.add(credential)
        session.commit()
        raise HTTPException(401, "Invalid credentials")
    credential.failed_login_count = 0
    credential.locked_until = None
    session.add(credential)
    session.commit()
    return AuthResponse(user_id=user.id, access_token=create_session(session, user.id))


@router.post("/auth/logout", response_model=LogoutResponse)
def logout(authorization: str | None = Header(default=None), current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> LogoutResponse:
    del current_user
    revoke_session(session, bearer_token(authorization))
    return LogoutResponse()


@router.post("/auth/password-reset/request")
def request_password_reset(payload: PasswordResetRequest, session: Session = Depends(get_session)) -> dict[str, str]:
    user = session.exec(select(User).where(User.email == payload.email)).first()
    if user:
        credential = session.exec(select(UserCredential).where(UserCredential.user_id == user.id)).first()
        if credential:
            token, token_hash = new_one_time_token()
            credential.reset_token_hash = token_hash
            credential.reset_token_expires_at = utcnow() + timedelta(minutes=get_settings().password_reset_minutes)
            session.add(credential)
            session.commit()
            if get_settings().app_env == "development":
                return {"status": "accepted", "development_token": token}
    return {"status": "accepted"}


@router.post("/auth/password-reset/confirm")
def confirm_password_reset(payload: PasswordResetConfirm, session: Session = Depends(get_session)) -> dict[str, str]:
    credential = session.exec(select(UserCredential).where(UserCredential.reset_token_hash == hash_secret(payload.token))).first()
    if not credential or not credential.reset_token_expires_at or credential.reset_token_expires_at <= utcnow():
        raise HTTPException(400, "Invalid or expired reset token")
    credential.password_hash = password_hash(payload.new_password)
    credential.reset_token_hash = None
    credential.reset_token_expires_at = None
    credential.failed_login_count = 0
    credential.locked_until = None
    session.add(credential)
    for user_session in session.exec(select(UserSession).where(UserSession.user_id == credential.user_id)):
        user_session.revoked_at = utcnow()
        session.add(user_session)
    session.commit()
    return {"status": "password_updated"}


@router.post("/auth/verify-email")
def verify_email(payload: EmailVerificationConfirm, session: Session = Depends(get_session)) -> dict[str, str]:
    credential = session.exec(select(UserCredential).where(UserCredential.verification_token_hash == hash_secret(payload.token))).first()
    if not credential:
        raise HTTPException(400, "Invalid verification token")
    credential.email_verified = True
    credential.verification_token_hash = None
    session.add(credential)
    session.commit()
    return {"status": "verified"}


@router.get("/me", response_model=User)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


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


@router.post("/me/resumes", response_model=ResumeDocument)
async def upload_resume(file: UploadFile = File(...), current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> ResumeDocument:
    folder = Path("uploads") / str(current_user.id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / Path(file.filename or "resume").name
    path.write_bytes(await file.read())
    mime = file.content_type or "application/octet-stream"
    text = extract_resume_text(str(path), mime)
    row = ResumeDocument(user_id=current_user.id, name=path.name, file_path=str(path), mime_type=mime, extracted_text=text)
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
def create_job(payload: JobCreate, session: Session = Depends(get_session)) -> Job:
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
    return [{"match_id": match.id, "job_id": job.id, "score": match.score, "recommendation": match.recommendation, "strengths": match.strengths, "gaps": match.gaps, "company": job.company, "title": job.title, "location": job.location, "work_type": job.work_type, "salary_min": job.salary_min, "salary_max": job.salary_max, "url": job.url, "source": job.source} for match, job in rows]


@router.get("/discovery/runs", response_model=list[SearchRun])
def discovery_runs(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> list[SearchRun]:
    return list(session.exec(select(SearchRun).where(SearchRun.user_id == current_user.id).order_by(SearchRun.created_at.desc())))


@router.post("/billing/checkout")
def checkout(current_user: User = Depends(get_current_user)) -> dict[str, str]:
    return {"url": create_checkout_url(current_user.id)}
