
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, delete, select

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models import (
    Application,
    CareerProfile,
    DiscoverySchedule,
    JobMatch,
    Opportunity,
    ResumeDocument,
    ResumeJobScore,
    ResumeSelection,
    SearchRun,
    TailoringProposal,
    User,
)
from kall.services.functional_areas import FUNCTIONAL_AREA_ALIASES
from kall.services.profile_suggestions import suggest_empty_fields
from kall.services.quota import assert_ai_allowed, record_ai_action
from kall.services.title_suggestions import ai_related_titles, related_titles

router = APIRouter()


class RelatedTitlesRequest(BaseModel):
    titles: list[str] = Field(default_factory=list, max_length=20)
    exclude: list[str] = Field(default_factory=list, max_length=100)


@router.post("/me/career-profiles/related-titles")
def related_title_suggestions(
    payload: RelatedTitlesRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    """Close variants of titles the person has already approved, so each
    confirmed title can surface the next few spellings job boards use. The
    rules-based set always answers; the model adds to it when configured and
    the account has AI actions left."""
    titles = [value.strip() for value in payload.titles if value and value.strip()]
    exclude = [value.strip() for value in payload.exclude if value and value.strip()]
    suggestions = related_titles(titles, exclude) if titles else []
    ai_enabled = bool(get_settings().openai_api_key)
    if titles and ai_enabled:
        assert_ai_allowed(session, current_user)
        extra = ai_related_titles(titles, [*exclude, *suggestions])
        if extra:
            record_ai_action(session, current_user)
            suggestions.extend(extra)
    return {"titles": suggestions[:12], "ai_enabled": ai_enabled}

_SUGGESTABLE_FIELDS = [
    "target_titles", "industries", "functional_areas", "work_types", "countries",
]


@router.get("/me/career-profiles/functional-areas")
def functional_area_options(current_user: User = Depends(get_current_user)) -> dict[str, object]:
    return {"areas": [{"name": name, "related_roles": list(aliases)}
                      for name, aliases in FUNCTIONAL_AREA_ALIASES.items()]}


class CareerProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_titles: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    functional_areas: list[str] = Field(default_factory=list)
    include_keywords: list[str] = Field(default_factory=list)
    exclude_keywords: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    states_regions: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    work_types: list[str] = Field(default_factory=list)
    employment_types: list[str] = Field(default_factory=lambda: ["full_time"])
    pay_basis: str = "salary"
    minimum_base: int | None = Field(default=None, ge=0)
    target_base: int | None = Field(default=None, ge=0)
    stretch_base: int | None = Field(default=None, ge=0)
    minimum_total_comp: int | None = Field(default=None, ge=0)
    target_total_comp: int | None = Field(default=None, ge=0)
    target_bonus_percent: float | None = Field(default=None, ge=0)
    travel_max_percent: int | None = Field(default=None, ge=0, le=100)
    relocation_preference: str | None = None
    equity_preference: str | None = None
    is_active: bool = True


def completeness(profile: CareerProfile) -> dict[str, object]:
    checks = {
        "target_titles": bool(profile.target_titles),
        "industries": bool(profile.industries),
        "locations": bool(profile.countries or profile.states_regions),
        "work_types": bool(profile.work_types),
        "compensation": profile.target_base is not None or profile.target_total_comp is not None,
        "keywords": bool(profile.include_keywords),
    }
    return {"score": round(sum(checks.values()) / len(checks) * 100), "checks": checks}


@router.get("/me/career-profiles")
def career_profiles(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    profiles = list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id)))
    resumes = {
        row.id: row.name
        for row in session.exec(select(ResumeDocument).where(ResumeDocument.user_id == current_user.id))
    }
    matches = list(session.exec(select(JobMatch).where(JobMatch.user_id == current_user.id)))
    match_counts: dict[int, int] = {}
    best_scores: dict[int, int] = {}
    for match in matches:
        match_counts[match.career_profile_id] = match_counts.get(match.career_profile_id, 0) + 1
        best_scores[match.career_profile_id] = max(best_scores.get(match.career_profile_id, 0), match.score)
    return {
        "profiles": [
            {
                "id": profile.id,
                "name": profile.name,
                "target_titles": profile.target_titles,
                "industries": profile.industries,
                "functional_areas": profile.functional_areas,
                "include_keywords": profile.include_keywords,
                "exclude_keywords": profile.exclude_keywords,
                "countries": profile.countries,
                "states_regions": profile.states_regions,
                "work_types": profile.work_types,
                "employment_types": profile.employment_types,
                "minimum_base": profile.minimum_base,
                "target_base": profile.target_base,
                "stretch_base": profile.stretch_base,
                "minimum_total_comp": profile.minimum_total_comp,
                "target_total_comp": profile.target_total_comp,
                "target_bonus_percent": profile.target_bonus_percent,
                "travel_max_percent": profile.travel_max_percent,
                "relocation_preference": profile.relocation_preference,
                "equity_preference": profile.equity_preference,
                "default_resume_id": profile.default_resume_id,
                "default_resume_name": resumes.get(profile.default_resume_id),
                "is_active": profile.is_active,
                "match_count": match_counts.get(profile.id, 0),
                "best_match_score": best_scores.get(profile.id),
                "completeness": completeness(profile),
            }
            for profile in profiles
        ]
    }


def _resume_text_for(session: Session, profile: CareerProfile, user_id: int) -> str:
    resume = None
    if profile.default_resume_id:
        resume = session.get(ResumeDocument, profile.default_resume_id)
    if not resume:
        resume = session.exec(
            select(ResumeDocument).where(ResumeDocument.user_id == user_id, ResumeDocument.is_default)
        ).first()
    if not resume:
        resume = session.exec(
            select(ResumeDocument).where(ResumeDocument.user_id == user_id).order_by(ResumeDocument.updated_at.desc())
        ).first()
    return (resume.extracted_text or "") if resume else ""


@router.post("/me/career-profiles/{profile_id}/suggest-fields")
def suggest_career_profile_fields(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    profile = session.get(CareerProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Career profile not found")

    empty_fields = [field for field in _SUGGESTABLE_FIELDS if not getattr(profile, field)]
    if not empty_fields:
        return {"enabled": True, "suggestions": {}, "rationale": "This profile already has every suggestible field filled in."}

    resume_text = _resume_text_for(session, profile, current_user.id)
    ai_enabled = bool(get_settings().openai_api_key)
    if ai_enabled:
        assert_ai_allowed(session, current_user)
    result = suggest_empty_fields(profile, empty_fields, resume_text)
    if result is None:
        return {"enabled": False, "suggestions": {}, "rationale": None}

    if ai_enabled:
        record_ai_action(session, current_user)
    rationale = result.pop("rationale", None)
    return {"enabled": True, "suggestions": result, "rationale": rationale}


@router.put("/me/career-profiles/{profile_id}")
def update_career_profile(
    profile_id: int,
    payload: CareerProfileUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CareerProfile:
    profile = session.get(CareerProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Career profile not found")
    # Preserve omitted values on unrelated updates. Explicit []/null still
    # clears a field, and complete existing PUT clients remain compatible.
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    profile.updated_at = utcnow()
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


@router.delete("/me/career-profiles/{profile_id}", status_code=204)
def delete_career_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    profile = session.get(CareerProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Career profile not found")

    # Applications and tailoring proposals are review/audit records. Require
    # the user to remove those through their dedicated flows rather than
    # silently erasing them as a side effect of deleting a search direction.
    if session.exec(select(Application.id).where(Application.career_profile_id == profile.id)).first():
        raise HTTPException(409, "Remove applications linked to this profile before deleting it.")
    if session.exec(select(TailoringProposal.id).where(TailoringProposal.professional_profile_id == profile.id)).first():
        raise HTTPException(409, "Remove tailoring proposals linked to this profile before deleting it.")

    for model, field in (
        (JobMatch, JobMatch.career_profile_id),
        (SearchRun, SearchRun.professional_profile_id),
        (ResumeJobScore, ResumeJobScore.professional_profile_id),
        (ResumeSelection, ResumeSelection.professional_profile_id),
        (DiscoverySchedule, DiscoverySchedule.professional_profile_id),
        (Opportunity, Opportunity.professional_profile_id),
    ):
        session.exec(delete(model).where(field == profile.id))
    session.delete(profile)
    session.commit()
