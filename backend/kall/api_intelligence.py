from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import Achievement, Job, JobRequirementAnalysis, ResumeDocument, ResumeParse, User
from kall.services.intelligence import analyze_job, parse_resume

router = APIRouter(prefix="/intelligence", tags=["resume-intelligence"])


class AchievementUpdate(BaseModel):
    achievement_text: str | None = None
    verification_status: str | None = None
    user_notes: str | None = None
    skills: list[str] | None = None
    technologies: list[str] | None = None
    industries: list[str] | None = None


@router.post("/resumes/{resume_id}/parse", response_model=ResumeParse)
def parse_resume_endpoint(
    resume_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ResumeParse:
    resume = session.get(ResumeDocument, resume_id)
    if not resume or resume.user_id != current_user.id:
        raise HTTPException(404, "Resume not found")
    parsed, warnings = parse_resume(resume.extracted_text or "")
    row = ResumeParse(user_id=current_user.id, resume_id=resume.id, parsed_json=parsed, warnings=warnings)
    session.add(row)
    session.commit()
    session.refresh(row)
    for item in parsed.get("achievements", []):
        session.add(Achievement(
            user_id=current_user.id,
            source_resume_id=resume.id,
            source_parse_id=row.id,
            achievement_text=item["text"],
            metrics=item.get("metrics", []),
            skills=item.get("skills", []),
        ))
    session.commit()
    # This commit expires every object the session has loaded, including
    # `row` from the commit above -- without a refresh, FastAPI serializes
    # an object whose attributes have been expired out from under it, which
    # silently produces an empty {} response body instead of a real error.
    session.refresh(row)
    return row


@router.get("/resumes/{resume_id}/parses", response_model=list[ResumeParse])
def list_resume_parses(
    resume_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[ResumeParse]:
    resume = session.get(ResumeDocument, resume_id)
    if not resume or resume.user_id != current_user.id:
        raise HTTPException(404, "Resume not found")
    return list(session.exec(select(ResumeParse).where(ResumeParse.resume_id == resume_id).order_by(ResumeParse.created_at.desc())))


@router.post("/jobs/{job_id}/analyze", response_model=JobRequirementAnalysis)
def analyze_job_endpoint(
    job_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> JobRequirementAnalysis:
    del current_user
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    existing = session.exec(select(JobRequirementAnalysis).where(JobRequirementAnalysis.job_id == job_id)).first()
    data = analyze_job(f"{job.title}\n{job.description}")
    if existing:
        for key, value in data.items():
            setattr(existing, key, value)
        row = existing
    else:
        row = JobRequirementAnalysis(job_id=job_id, **data)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/achievements", response_model=list[Achievement])
def list_achievements(
    verification_status: str | None = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[Achievement]:
    statement = select(Achievement).where(Achievement.user_id == current_user.id)
    if verification_status:
        statement = statement.where(Achievement.verification_status == verification_status)
    return list(session.exec(statement.order_by(Achievement.created_at.desc())))


@router.patch("/achievements/{achievement_id}", response_model=Achievement)
def update_achievement(
    achievement_id: int,
    payload: AchievementUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Achievement:
    row = session.get(Achievement, achievement_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(404, "Achievement not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    if row.verification_status not in {"suggested", "verified", "rejected"}:
        raise HTTPException(422, "Invalid verification status")
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
