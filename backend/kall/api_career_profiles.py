from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import CareerProfile, JobMatch, ResumeDocument, User

router = APIRouter()


class CareerProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_titles: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    functional_areas: list[str] = Field(default_factory=list)
    include_keywords: list[str] = Field(default_factory=list)
    exclude_keywords: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    states_regions: list[str] = Field(default_factory=list)
    work_types: list[str] = Field(default_factory=list)
    minimum_base: int | None = Field(default=None, ge=0)
    target_base: int | None = Field(default=None, ge=0)
    stretch_base: int | None = Field(default=None, ge=0)
    target_total_comp: int | None = Field(default=None, ge=0)
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
                "minimum_base": profile.minimum_base,
                "target_base": profile.target_base,
                "stretch_base": profile.stretch_base,
                "target_total_comp": profile.target_total_comp,
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
    for key, value in payload.model_dump().items():
        setattr(profile, key, value)
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile
