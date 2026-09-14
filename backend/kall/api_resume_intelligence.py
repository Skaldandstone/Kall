import contextlib
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models import Application, CareerProfile, JobMatch, ResumeDocument, User
from kall.services import quota
from kall.services.intelligence import parse_resume
from kall.services.onboarding_ai import deterministic_career_strategy, suggest_career_strategy
from kall.services.openai_json import ask_for_json
from kall.services.quota import assert_ai_allowed, record_ai_action
from kall.services.resume_proofreading import find_repeated_lines, proofreading_gaps
from kall.services.resume_readiness import resume_readiness
from kall.services.storage import get_storage
from kall.services.tailoring import immutable_tokens

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
    #: Metadata a recommendation can add on top of the text edit. Populated
    #: when the recommendation is specifically about filling in a scoring
    #: field (target roles, industries, skill tags) rather than rewriting
    #: prose -- empty for ordinary text recommendations.
    target_titles: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


def _resume_score(resume: ResumeDocument) -> tuple[int, list[str], list[str]]:
    # Kept as a compatibility alias for focused tests and older imports.
    return resume_readiness(resume)


def _owned_resume(resume_id: int, user_id: int, session: Session) -> ResumeDocument:
    resume = session.get(ResumeDocument, resume_id)
    if not resume or resume.user_id != user_id:
        raise HTTPException(404, "Resume not found")
    return resume


def _dedupe_repeated_lines(text: str) -> str | None:
    """Drop later occurrences of any line find_repeated_lines flags. Returns
    None when there is nothing repeated to fix.
    """
    repeats = set(find_repeated_lines(text))
    if not repeats:
        return None
    seen: set[str] = set()
    kept: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped in repeats:
            if stripped in seen:
                continue
            seen.add(stripped)
        kept.append(line)
    return "\n".join(kept)


def _fallback_recommendations(resume: ResumeDocument, profile_titles: list[str]) -> list[dict]:
    text = (resume.extracted_text or "").strip()
    recommendations: list[dict] = []
    if not resume.target_titles and profile_titles:
        # A real signal already on file (the user's active career profiles),
        # not a guess -- filling this in is what actually moves the
        # "Target roles are defined" points in _resume_score.
        recommendations.append({
            "id": "target-titles",
            "section": "Target roles",
            "title": "Set target roles from your career profile",
            "reason": "No target titles are stored on this resume, so role alignment cannot be evaluated.",
            "current_text": "No target titles are currently stored.",
            "proposed_text": ", ".join(profile_titles[:3]),
            "confidence": 100,
            "target_titles": profile_titles[:3],
        })
    if not resume.tags:
        parsed, _ = parse_resume(text)
        tags = list(dict.fromkeys(parsed.get("skills") or []))[:8]
        if tags:
            recommendations.append({
                "id": "skills-metadata",
                "section": "Skills",
                "title": "Save skills already named in this resume",
                "reason": "These skills were extracted from the resume text and can improve matching.",
                "current_text": "No resume skill tags are currently stored.",
                "proposed_text": ", ".join(tags) + ".",
                "confidence": 100,
                "tags": tags,
            })
    deduped = _dedupe_repeated_lines(text)
    if deduped is not None:
        recommendations.append({
            "id": "proofreading-dedupe",
            "section": "Formatting",
            "title": "Remove the duplicated line",
            "reason": "A line appears more than once, which reads as a copy-paste error and can confuse an ATS parser.",
            "current_text": text,
            "proposed_text": deduped,
            "confidence": 100,
        })
    return recommendations


def _ai_recommendations(
    resume: ResumeDocument, profile_titles: list[str]
) -> tuple[list[dict], bool]:
    settings = get_settings()
    if not settings.openai_api_key:
        return _fallback_recommendations(resume, profile_titles), False
    resume_text = (resume.extracted_text or "").strip()
    if not resume_text:
        return _fallback_recommendations(resume, profile_titles), False
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
                        "target_titles": {"type": "array", "items": {"type": "string"}},
                        "industries": {"type": "array", "items": {"type": "string"}},
                        "tags": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": [
                        "id", "section", "title", "reason", "current_text", "proposed_text",
                        "confidence", "target_titles", "industries", "tags",
                    ],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["recommendations"],
        "additionalProperties": False,
    }
    gaps = proofreading_gaps(resume_text)
    rubric = (
        "Readiness is scored from: resume text length, whether target_titles/industries/tags are set, "
        "whether this is the default resume, version history, and a proofreading penalty of 8 points per "
        "issue below. Every recommendation you propose should move one of these factors, not just reword text.\n"
        f"Missing metadata: target_titles={'set' if resume.target_titles else 'MISSING'}, "
        f"industries={'set' if resume.industries else 'MISSING'}, tags={'set' if resume.tags else 'MISSING'}.\n"
        f"Proofreading issues found on this resume: {'; '.join(gaps) if gaps else 'none'}.\n"
        "When metadata is missing and you have real evidence for it (target roles from the resume or the "
        "profile list below, industries actually implied by the experience described, skills actually named "
        "in the resume), populate target_titles/industries/tags on the relevant recommendation -- never invent "
        "roles, industries, or skills the resume does not support. When a proofreading issue is listed above, "
        "include a recommendation whose proposed_text fixes it (deduplicate the repeated line, add a placeholder "
        "verified metric, or trim toward one to two pages)."
    )
    prompt = (
        "Analyze this resume and return only evidence-preserving improvements. Never invent employers, dates, titles, metrics, skills, or achievements. "
        "Proposed text may improve clarity and positioning, but use placeholders such as [add verified metric] when evidence is missing. "
        f"Target roles from active career profiles: {', '.join(profile_titles) or 'not specified'}.\n\n{rubric}\n\nRESUME:\n{resume_text[:30000]}"
    )
    parsed = ask_for_json(
        prompt,
        schema_name="resume_recommendations",
        schema=schema,
        purpose="resume recommendations",
        source_ref=f"resume:{resume.id}:v{resume.version}",
    )
    if parsed is None:
        return _fallback_recommendations(resume, profile_titles), False
    try:
        recommendations = [
            ResumeRecommendation.model_validate(item).model_dump()
            for item in parsed.get("recommendations", [])
        ]
        source_numbers = set(immutable_tokens(resume_text))
        supported = [
            item
            for item in recommendations
            if set(immutable_tokens(item["proposed_text"])).issubset(source_numbers)
        ]
        return supported, True
    except ValidationError:
        # Well-formed JSON that is not the shape we asked for.
        return _fallback_recommendations(resume, profile_titles), False


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
    ai_enabled = bool(get_settings().openai_api_key)
    if ai_enabled:
        assert_ai_allowed(session, current_user)
    recommendations, used_ai = _ai_recommendations(resume, profile_titles)
    if used_ai:
        record_ai_action(session, current_user)
    return {"resume_id": resume.id, "recommendations": recommendations, "ai_enabled": ai_enabled}


@router.post("/me/resumes/{resume_id}/suggest-strategy")
def suggest_strategy(resume_id: int, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    text = resume.extracted_text or ""
    ai_enabled = bool(get_settings().openai_api_key)
    suggestion = None
    if ai_enabled:
        # The allowance guards real model calls, not this endpoint -- a
        # deterministic fallback still runs for an account with none left,
        # since it costs nothing and there is otherwise no path to it.
        assert_ai_allowed(session, current_user)
        suggestion = suggest_career_strategy(text)
        # Only charge when the model actually answered. This falls back to
        # None when the call fails, and nobody should spend an allowance on
        # a request that produced nothing.
        if suggestion:
            record_ai_action(session, current_user)
    if not suggestion:
        suggestion = deterministic_career_strategy(text)
    return {
        "ai_enabled": ai_enabled,
        "suggestion": suggestion,
    }


def _build_revision(resume: ResumeDocument, payload: ApplyRecommendationsRequest) -> dict:
    """Compute the text and metadata a revision would produce, without
    touching the database or storage -- shared by the preview and apply
    endpoints so what you preview is exactly what gets saved.
    """
    selected = [item for item in payload.recommendations if item.get("id") in payload.recommendation_ids]
    if not selected:
        raise HTTPException(400, "Select at least one recommendation")
    revised_text = (resume.extracted_text or "").strip()
    tags = list(resume.tags)
    industries = list(resume.industries)
    target_titles = list(resume.target_titles)
    applied: list[str] = []
    for item in selected:
        current_text = str(item.get("current_text") or "").strip()
        proposed_text = str(item.get("proposed_text") or "").strip()
        applied_this_item = False
        if proposed_text:
            if current_text and current_text in revised_text:
                revised_text = revised_text.replace(current_text, proposed_text, 1)
            else:
                revised_text = f"{revised_text}\n\n{item.get('section', 'Improvement')}\n{proposed_text}".strip()
            applied_this_item = True
        for value in item.get("target_titles") or []:
            if value not in target_titles:
                target_titles.append(value)
                applied_this_item = True
        for value in item.get("industries") or []:
            if value not in industries:
                industries.append(value)
                applied_this_item = True
        for value in item.get("tags") or []:
            if value not in tags:
                tags.append(value)
                applied_this_item = True
        if applied_this_item:
            applied.append(str(item.get("id")))
    if not applied:
        raise HTTPException(400, "The selected recommendations did not contain applicable changes")
    return {
        "revised_text": revised_text, "tags": tags, "industries": industries,
        "target_titles": target_titles, "applied": applied,
    }


@router.post("/me/resumes/{resume_id}/preview-recommendations")
def preview_recommendations(resume_id: int, payload: ApplyRecommendationsRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    revision = _build_revision(resume, payload)
    current_score, _, _ = _resume_score(resume)
    projected = ResumeDocument(
        user_id=resume.user_id, name=resume.name, file_path=resume.file_path, mime_type=resume.mime_type,
        byte_size=len(revision["revised_text"].encode("utf-8")), tags=revision["tags"], industries=revision["industries"],
        target_titles=revision["target_titles"], extracted_text=revision["revised_text"],
        is_default=resume.is_default, version=resume.version + 1,
    )
    projected_score, projected_strengths, projected_gaps = _resume_score(projected)
    return {
        "resume_id": resume.id,
        "current_text": resume.extracted_text or "",
        "revised_text": revision["revised_text"],
        "current_score": current_score,
        "projected_score": projected_score,
        "projected_strengths": projected_strengths,
        "projected_gaps": projected_gaps,
        "tags": revision["tags"], "industries": revision["industries"], "target_titles": revision["target_titles"],
        "applied_recommendation_ids": revision["applied"],
    }


@router.post("/me/resumes/{resume_id}/apply-recommendations")
def apply_recommendations(resume_id: int, payload: ApplyRecommendationsRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    revision = _build_revision(resume, payload)
    revised_text = revision["revised_text"]
    key = f"data/generated-resumes/resume-{current_user.id}-{uuid4().hex}.txt"
    body = revised_text.encode("utf-8")
    quota.check(session, current_user, "storage_bytes", amount=len(body))
    get_storage().save(key, body)
    # A revision of the default resume supersedes it as the default --
    # otherwise the new version silently loses the 10 default-resume points
    # while the stale source keeps carrying them.
    was_default = resume.is_default
    if was_default:
        resume.is_default = False
        session.add(resume)
    new_resume = ResumeDocument(
        user_id=current_user.id, name=f"{resume.name} — AI revision", file_path=key, mime_type="text/plain",
        byte_size=len(body),
        tags=revision["tags"], industries=revision["industries"], target_titles=revision["target_titles"],
        extracted_text=revised_text, is_default=was_default, version=resume.version + 1,
    )
    session.add(new_resume)
    session.commit()
    session.refresh(new_resume)
    return {"resume_id": new_resume.id, "source_resume_id": resume.id, "version": new_resume.version, "applied_recommendation_ids": revision["applied"]}


@router.delete("/me/resumes/{resume_id}")
def delete_resume(resume_id: int, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    resume = _owned_resume(resume_id, current_user.id, session)
    profiles = list(session.exec(select(CareerProfile).where(CareerProfile.user_id == current_user.id, CareerProfile.default_resume_id == resume.id)))
    for profile in profiles:
        profile.default_resume_id = None
        profile.updated_at = utcnow()
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
