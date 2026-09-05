from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import (
    AwardHonor,
    CareerProfile,
    Certification,
    Contact,
    Education,
    EEOProfile,
    Employment,
    FieldPrivacy,
    Language,
    OnboardingProgress,
    Patent,
    ProfessionalMembership,
    Publication,
    Reference,
    ResumeDocument,
    SecurityClearance,
    Skill,
    SpeakingEngagement,
    User,
    VolunteerBoardService,
    WorkAuthorization,
)
from kall.models.enums import PrivacyScope
from kall.security import encrypt_sensitive
from kall.services.skill_vocabulary import canonical_skill, normalize_skill, suggest_skill

router = APIRouter(prefix="/profile", tags=["profile"])


class RecordPayload(BaseModel):
    data: dict[str, Any]


class OnboardingPayload(BaseModel):
    current_step: str
    completed_steps: list[str] = Field(default_factory=list)
    dismissed_steps: list[str] = Field(default_factory=list)
    is_complete: bool = False


class PrivacyPayload(BaseModel):
    field_path: str
    scopes: list[PrivacyScope] = Field(default_factory=lambda: [PrivacyScope.PRIVATE])
    require_confirmation: bool = True


class EEOProfilePayload(BaseModel):
    veteran_status: str | None = None
    disability_status: str | None = None
    race_ethnicity: str | None = None
    gender_identity: str | None = None
    decline_to_answer_defaults: bool = True
    confirmation_required: bool = True


class WorkAuthorizationPayload(BaseModel):
    country: str
    authorization_type: str
    citizenship_status: str | None = None
    visa_type: str | None = None
    requires_current_sponsorship: bool = False
    requires_future_sponsorship: bool = False
    confirmation_required: bool = True


RESOURCE_MODELS = {
    "education": Education,
    "employment": Employment,
    "skills": Skill,
    "certifications": Certification,
    "clearances": SecurityClearance,
    "languages": Language,
    "awards": AwardHonor,
    "publications": Publication,
    "patents": Patent,
    "speaking": SpeakingEngagement,
    "memberships": ProfessionalMembership,
    "service": VolunteerBoardService,
    "references": Reference,
    "contacts": Contact,
}

SENSITIVE_KEYS = {
    "credential_id": "credential_id_encrypted",
    "agency": "agency_encrypted",
    "sponsor": "sponsor_encrypted",
    "email": "email_encrypted",
    "phone": "phone_encrypted",
    "notes": "notes_encrypted",
}


def _model(resource: str):
    model = RESOURCE_MODELS.get(resource)
    if not model:
        raise HTTPException(404, "Unknown profile resource")
    return model


def _clean_data(data: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(data)
    for plain, encrypted in SENSITIVE_KEYS.items():
        if plain in cleaned:
            cleaned[encrypted] = encrypt_sensitive(cleaned.pop(plain))
    return cleaned


@router.get("/onboarding", response_model=OnboardingProgress)
def get_onboarding(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OnboardingProgress:
    row = session.exec(
        select(OnboardingProgress).where(OnboardingProgress.user_id == current_user.id)
    ).first()
    if not row:
        row = OnboardingProgress(user_id=current_user.id)
        session.add(row)
        session.commit()
        session.refresh(row)

    # A profile created by any path other than this wizard -- the mobile app
    # has no onboarding screen of its own, an admin action, a future web
    # entry point -- never PUTs is_complete=true, which stranded that user in
    # a redirect loop back to /onboarding forever despite already having real
    # profile data. This flag is meant to track "does this account have a
    # career profile," so self-heal it from the actual data whenever a wizard
    # somewhere failed to record it.
    if not row.is_complete:
        has_profile = session.exec(
            select(CareerProfile.id).where(CareerProfile.user_id == current_user.id)
        ).first()
        if has_profile:
            row.current_step = "complete"
            row.is_complete = True
            session.add(row)
            session.commit()
            session.refresh(row)

    return row


@router.put("/onboarding", response_model=OnboardingProgress)
def update_onboarding(
    payload: OnboardingPayload,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> OnboardingProgress:
    row = session.exec(
        select(OnboardingProgress).where(OnboardingProgress.user_id == current_user.id)
    ).first() or OnboardingProgress(user_id=current_user.id)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/privacy", response_model=list[FieldPrivacy])
def list_privacy(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[FieldPrivacy]:
    return list(
        session.exec(select(FieldPrivacy).where(FieldPrivacy.user_id == current_user.id))
    )


@router.put("/privacy/{field_path:path}", response_model=FieldPrivacy)
def upsert_privacy(
    field_path: str,
    payload: PrivacyPayload,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FieldPrivacy:
    scopes = [scope.value for scope in payload.scopes]
    if field_path.startswith(("eeo.", "work_authorization.", "references.")) and PrivacyScope.PUBLIC_PROFILE.value in scopes:
        raise HTTPException(422, "Sensitive fields cannot be public")
    row = session.exec(
        select(FieldPrivacy).where(
            FieldPrivacy.user_id == current_user.id,
            FieldPrivacy.field_path == field_path,
        )
    ).first() or FieldPrivacy(user_id=current_user.id, field_path=field_path)
    row.scopes = scopes
    row.require_confirmation = payload.require_confirmation
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/resources/{resource}")
def list_resource(
    resource: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[Any]:
    model = _model(resource)
    return list(session.exec(select(model).where(model.user_id == current_user.id)))


@router.post("/resources/{resource}")
def create_resource(
    resource: str,
    payload: RecordPayload,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Any:
    model = _model(resource)
    # model_validate rather than the constructor: SQLModel's constructor takes
    # kwargs as-is without coercion, so a JSON date like "2015-06-01" reached
    # SQLite as a str and every date-bearing profile resource (education's
    # graduation_date, employment's start/end dates, certification validity)
    # died with "SQLite Date type only accepts Python date objects".
    row = model.model_validate({**_clean_data(payload.data), "user_id": current_user.id})
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.patch("/resources/{resource}/{record_id}")
def update_resource(
    resource: str,
    record_id: int,
    payload: RecordPayload,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Any:
    model = _model(resource)
    row = session.get(model, record_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(404, "Profile record not found")
    cleaned = _clean_data(payload.data)
    unknown = [key for key in cleaned if not hasattr(row, key)]
    if unknown:
        raise HTTPException(422, f"Unknown field: {unknown[0]}")
    # Round-trip through the model so incoming values are coerced to their
    # declared types (same reason as create_resource above), then copy only
    # the keys the caller actually sent.
    coerced = model.model_validate({**row.model_dump(), **cleaned})
    for key in cleaned:
        if key in {"id", "user_id", "created_at"}:
            continue
        setattr(row, key, getattr(coerced, key))
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.delete("/resources/{resource}/{record_id}", status_code=204)
def delete_resource(
    resource: str,
    record_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    model = _model(resource)
    row = session.get(model, record_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(404, "Profile record not found")
    session.delete(row)
    session.commit()


@router.put("/eeo", response_model=EEOProfile)
def upsert_eeo(
    payload: EEOProfilePayload,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EEOProfile:
    row = session.exec(select(EEOProfile).where(EEOProfile.user_id == current_user.id)).first() or EEOProfile(user_id=current_user.id)
    row.veteran_status_encrypted = encrypt_sensitive(payload.veteran_status)
    row.disability_status_encrypted = encrypt_sensitive(payload.disability_status)
    row.race_ethnicity_encrypted = encrypt_sensitive(payload.race_ethnicity)
    row.gender_identity_encrypted = encrypt_sensitive(payload.gender_identity)
    row.decline_to_answer_defaults = payload.decline_to_answer_defaults
    row.confirmation_required = True
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.put("/work-authorization", response_model=WorkAuthorization)
def upsert_work_authorization(
    payload: WorkAuthorizationPayload,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> WorkAuthorization:
    row = session.exec(
        select(WorkAuthorization).where(
            WorkAuthorization.user_id == current_user.id,
            WorkAuthorization.country == payload.country,
        )
    ).first() or WorkAuthorization(
        user_id=current_user.id,
        country=payload.country,
        authorization_type=payload.authorization_type,
    )
    row.authorization_type = payload.authorization_type
    row.citizenship_status_encrypted = encrypt_sensitive(payload.citizenship_status)
    row.visa_type_encrypted = encrypt_sensitive(payload.visa_type)
    row.requires_current_sponsorship = payload.requires_current_sponsorship
    row.requires_future_sponsorship = payload.requires_future_sponsorship
    row.confirmation_required = True
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.post("/resumes/{resume_id}/version", response_model=ResumeDocument)
def create_resume_version(
    resume_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ResumeDocument:
    source = session.get(ResumeDocument, resume_id)
    if not source or source.user_id != current_user.id:
        raise HTTPException(404, "Resume not found")
    row = ResumeDocument(
        user_id=current_user.id,
        name=source.name,
        file_path=source.file_path,
        mime_type=source.mime_type,
        tags=source.tags,
        industries=source.industries,
        target_titles=source.target_titles,
        extracted_text=source.extracted_text,
        is_default=False,
        version=source.version + 1,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/readiness")
def readiness(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    from kall.models import CandidateProfile, CareerProfile

    identity = session.exec(select(CandidateProfile).where(CandidateProfile.user_id == current_user.id)).first()
    professional_profiles = list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id)))
    resumes = list(session.exec(select(ResumeDocument).where(ResumeDocument.user_id == current_user.id)))
    privacy = list(session.exec(select(FieldPrivacy).where(FieldPrivacy.user_id == current_user.id)))
    work_auth = list(session.exec(select(WorkAuthorization).where(WorkAuthorization.user_id == current_user.id)))
    education = list(session.exec(select(Education).where(Education.user_id == current_user.id)))
    skills = list(session.exec(select(Skill).where(Skill.user_id == current_user.id)))

    sections = {
        "identity": 100 if identity and identity.professional_summary and identity.country else 60 if identity else 0,
        "professional_profiles": 100 if professional_profiles else 0,
        "resume_studio": 100 if resumes else 0,
        "education": 100 if education else 0,
        "skills": min(100, len(skills) * 10),
        "work_authorization": 100 if work_auth else 0,
        "privacy": min(100, len(privacy) * 10),
    }
    overall = round(sum(sections.values()) / len(sections))
    missing = [name for name, score in sections.items() if score < 100]
    return {"overall": overall, "sections": sections, "missing": missing}


class SkillCheckRequest(BaseModel):
    names: list[str] = Field(default_factory=list, max_length=100)


class SkillCheckResult(BaseModel):
    input: str
    #: The vocabulary's own spelling when the term is recognised.
    canonical: str | None = None
    #: A likely intended spelling when it is not, or None to leave it alone.
    suggestion: str | None = None


@router.post("/skills/spellcheck", response_model=list[SkillCheckResult])
def spellcheck_skills(
    payload: SkillCheckRequest,
    current_user: User = Depends(get_current_user),
) -> list[SkillCheckResult]:
    """Check typed skill names against the shared vocabulary.

    Advisory only -- it never rejects anything. The vocabulary cannot be
    complete, so an unrecognised skill comes back with no suggestion rather
    than an error, and the caller is free to save exactly what was typed.
    """
    del current_user
    return [
        SkillCheckResult(
            input=normalize_skill(name),
            canonical=canonical_skill(name),
            suggestion=suggest_skill(name),
        )
        for name in payload.names
        if normalize_skill(name)
    ]
