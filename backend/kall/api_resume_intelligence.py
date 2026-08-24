import contextlib
import json
from datetime import datetime
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.config import get_settings
from kall.db import get_session
from kall.models import Application, CareerProfile, JobMatch, ResumeDocument, User
from kall.services.onboarding_ai import suggest_career_strategy
from kall.services.storage import get_storage

router = APIRouter()


class ApplyRecommendationsRequest(BaseModel):
    recommendation_ids: list[str] = Field(min_length=1)
    recommendations: list[dict]


class ResumeRecommendation(BaseModel):
    id: str
    section: str
    title: str
    reason: str
    current_text: str
    proposed_text: str
    confidence: int


def _resume_score(resume: ResumeDocument) -> tuple[int, list[str], list[str]]:
    strengths: list[str] = []
    gaps: list[str] = []
    score = 20
    text_length = len((resume.extracted_text or "").strip())
    if text_length >= 1200:
        score += 30
        strengths.append("Substantial resume text is available for matching and tailoring.")
    elif text_length >= 400:
        score += 18
        strengths.append("Resume text was extracted successfully.")
    else:
        gaps.append("Upload a text-readable PDF or DOCX with fuller experience detail.")
    if resume.target_titles:
        score += 15
        strengths.append("Target roles are defined.")
    else:
        gaps.append("Add target titles so Kall can evaluate role alignment.")
    if resume.industries:
        score += 10
        strengths.append("Industry focus is tagged.")
    else:
        gaps.append("Add one or more target industries.")
    if resume.tags:
        score += 10
        strengths.append("Searchable resume tags are present.")
    else:
        gaps.append("Add skill or specialization tags.")
    if resume.is_default:
        score += 10
        strengths.append("This is the default resume.")
    if resume.version > 1:
        score += 5
        strengths.append("The resume has version history.")
    return min(score, 100), strengths, gaps


def _owned_resume(resume_id: int, user_id: int, session: Session) -> ResumeDocument:
    resume = session.get(ResumeDocument, resume_id)
    if not resume or resume.user_id != user_id:
        raise HTTPException(404, "Resume not found")
    return resume


def _fallback_recommendations(resume: ResumeDocument) -> list[dict]:
    text = (resume.extracted_text or "").strip()
    recommendations: list[dict] = []
    if resume.target_titles:
        target = resume.target_titles[0]
        recommendations.append({
            "id": "target-summary",
            "section": "Professional summary",
            "title": f"Lead with your {target} positioning",
            "reason": "The opening should immediately connect your evidence to the selected target role.",
            "current_text": text[:500],
            "proposed_text": f"{target} leader with a record of building reliable delivery systems, developing high-performing teams, and translating quality strategy into measurable business outcomes.",
            "confidence": 82,
        })
    if not resume.tags:
        recommendations.append({
            "id": "skills-metadata",
            "section": "Skills",
            "title": "Add searchable specialization language",
            "reason": "Specific skills improve matching and make the resume easier to tailor.",
            "current_text": "No resume skill tags are currently stored.",
            "proposed_text": "Quality engineering strategy, test automation, release governance, risk management, CI/CD, metrics, and cross-functional leadership.",
            "confidence": 88,
        })
    return recommendations


def _ai_recommendations(resume: ResumeDocument, profile_titles: list[str]) -> list[dict]:
    settings = get_settings()
    if not settings.openai_api_key:
        return _fallback_recommendations(resume)
    resume_text = (resume.extracted_text or "").strip()
    if not resume_text:
        return _fallback_recommendations(resume)
    schema = {
        "type": "object",
        "properties": {
            "recommendations": {
                "type": "array",
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "section": {"type": "string"},
                        "title": {"type": "string"},
                        "reason": {"type": "string"},
                        "current_text": {"type": "string"},
                        "proposed_text": {"type": "string"},
                        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    },
                    "required": ["id", "section", "title", "reason", "current_text", "proposed_text", "confidence"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["recommendations"],
        "additionalProperties": False,
    }
    prompt = (
        "Analyze this resume and return only evidence-preserving improvements. Never invent employers, dates, titles, metrics, skills, or achievements. "
        "Proposed text may improve clarity and positioning, but use placeholders such as [add verified metric] when evidence is missing. "
        f"Target roles: {', '.join(profile_titles or resume.target_titles) or 'not specified'}.\n\nRESUME:\n{resume_text[:30000]}"
    )
    try:
        response = httpx.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
            json={
                "model": settings.openai_model,
                "input": prompt,
                "text": {"format": {"type": "json_schema", "name": "resume_recommendations", "strict": True, "schema": schema}},
            },
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        output_text = payload.get("output_text")
        if not output_text:
            for item in payload.get("output", []):
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        output_text = content.get("text")
                        break
        parsed = json.loads(output_text or "{}")
        return [ResumeRecommendation.model_validate(item).model_dump() for item in parsed.get("recommendations", [])]
    except Exception:
        return _fallback_recommendations(resume)


@router.get("/me/resume-intelligence")
def resume_intelligence(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resumes = list(session.exec(select(ResumeDocument).where(ResumeDocument.user_id == current_user.id).order_by(ResumeDocument.updated_at.desc())))
    profiles = list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id, CareerProfile.is_active)))
    profile_titles = sorted({title for profile in profiles for title in profile.target_titles})
    rows = []
    for resume in resumes:
        score, strengths, gaps = _resume_score(resume)
        aligned_titles = sorted(set(resume.target_titles).intersection(profile_titles))
        rows.append({
            "id": resume.id, "name": resume.name, "version": resume.version, "is_default": resume.is_default,
            "tags": resume.tags, "industries": resume.industries, "target_titles": resume.target_titles,
            "updated_at": resume.updated_at, "readiness_score": score, "strengths": strengths, "gaps": gaps,
            "aligned_profile_titles": aligned_titles, "text_character_count": len(resume.extracted_text or ""),
        })
    best = max(rows, key=lambda row: row["readiness_score"], default=None)
    return {"summary": {"resume_count": len(rows), "profile_count": len(profiles), "best_resume_id": best["id"] if best else None, "best_score": best["readiness_score"] if best else None, "default_resume_id": next((row["id"] for row in rows if row["is_default"]), None)}, "resumes": rows, "profile_titles": profile_titles}


@router.post("/me/resumes/{resume_id}/recommendations")
def generate_recommendations(resume_id: int, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    profiles = list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id, CareerProfile.is_active)))
    profile_titles = sorted({title for profile in profiles for title in profile.target_titles})
    return {"resume_id": resume.id, "recommendations": _ai_recommendations(resume, profile_titles), "ai_enabled": bool(get_settings().openai_api_key)}


@router.post("/me/resumes/{resume_id}/suggest-strategy")
def suggest_strategy(resume_id: int, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    return {
        "ai_enabled": bool(get_settings().openai_api_key),
        "suggestion": suggest_career_strategy(resume.extracted_text or ""),
    }


@router.post("/me/resumes/{resume_id}/apply-recommendations")
def apply_recommendations(resume_id: int, payload: ApplyRecommendationsRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    selected = [item for item in payload.recommendations if item.get("id") in payload.recommendation_ids]
    if not selected:
        raise HTTPException(400, "Select at least one recommendation")
    revised_text = (resume.extracted_text or "").strip()
    applied: list[str] = []
    for item in selected:
        current_text = str(item.get("current_text") or "").strip()
        proposed_text = str(item.get("proposed_text") or "").strip()
        if not proposed_text:
            continue
        if current_text and current_text in revised_text:
            revised_text = revised_text.replace(current_text, proposed_text, 1)
        else:
            revised_text = f"{revised_text}\n\n{item.get('section', 'Improvement')}\n{proposed_text}".strip()
        applied.append(str(item.get("id")))
    if not applied:
        raise HTTPException(400, "The selected recommendations did not contain applicable text")
    key = f"data/generated-resumes/resume-{current_user.id}-{uuid4().hex}.txt"
    get_storage().save(key, revised_text.encode("utf-8"))
    new_resume = ResumeDocument(
        user_id=current_user.id, name=f"{resume.name} — AI revision", file_path=key, mime_type="text/plain",
        tags=list(resume.tags), industries=list(resume.industries), target_titles=list(resume.target_titles), extracted_text=revised_text,
        is_default=False, version=resume.version + 1,
    )
    session.add(new_resume)
    session.commit()
    session.refresh(new_resume)
    return {"resume_id": new_resume.id, "source_resume_id": resume.id, "version": new_resume.version, "applied_recommendation_ids": applied}


@router.delete("/me/resumes/{resume_id}")
def delete_resume(resume_id: int, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    profiles = list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id, CareerProfile.default_resume_id == resume.id)))
    for profile in profiles:
        profile.default_resume_id = None
        profile.updated_at = datetime.utcnow()
        session.add(profile)
    matches = list(session.exec(select(JobMatch).where(JobMatch.user_id == current_user.id, JobMatch.selected_resume_id == resume.id)))
    for match in matches:
        match.selected_resume_id = None
        session.add(match)
    applications = list(session.exec(select(Application).where(Application.user_id == current_user.id, Application.base_resume_id == resume.id)))
    for application in applications:
        application.base_resume_id = None
        session.add(application)
    file_key = resume.file_path
    session.delete(resume)
    session.commit()
    with contextlib.suppress(Exception):
        get_storage().delete(file_key)
    return {"removed": True, "resume_id": resume_id}
