from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import CareerProfile, ResumeDocument, User
from kall.services.resume_readiness import resume_readiness

router = APIRouter()


class DefaultResumeRequest(BaseModel):
    resume_id: int | None


def readiness(resume: ResumeDocument) -> dict[str, object]:
    score, strengths, gaps = resume_readiness(resume)
    return {
        "score": score,
        "strengths": strengths,
        "gaps": gaps,
        "explanation": (
            "This score measures whether Kall has enough readable resume content, target labels, "
            "and reusable evidence for matching and tailoring. It is not a comparison with one job."
        ),
    }


@router.get("/me/resume-studio")
def resume_studio(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    resumes = list(session.exec(select(ResumeDocument).where(ResumeDocument.user_id == current_user.id)))
    profiles = list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id)))
    return {
        "resumes": [
            {
                "id": resume.id,
                "name": resume.name,
                "version": resume.version,
                "tags": resume.tags,
                "industries": resume.industries,
                "target_titles": resume.target_titles,
                "is_default": resume.is_default,
                "created_at": resume.created_at,
                "updated_at": resume.updated_at,
                "readiness": readiness(resume),
            }
            for resume in resumes
        ],
        "profiles": [
            {
                "id": profile.id,
                "name": profile.name,
                "target_titles": profile.target_titles,
                "default_resume_id": profile.default_resume_id,
            }
            for profile in profiles
        ],
    }


@router.put("/me/professional-profiles/{profile_id}/default-resume")
def set_default_resume(
    profile_id: int,
    payload: DefaultResumeRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, object]:
    profile = session.get(CareerProfile, profile_id)
    if not profile or profile.user_id != current_user.id:
        raise HTTPException(404, "Professional profile not found")
    if payload.resume_id is not None:
        resume = session.get(ResumeDocument, payload.resume_id)
        if not resume or resume.user_id != current_user.id:
            raise HTTPException(404, "Resume not found")
    profile.default_resume_id = payload.resume_id
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return {"profile_id": profile.id, "default_resume_id": profile.default_resume_id}
