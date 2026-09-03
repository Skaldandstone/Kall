
from kall.config import get_settings
from kall.services.intelligence import parse_resume
from kall.services.openai_json import ask_for_json

_STRATEGY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "target_titles": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
        "industries": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
        "keywords": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
        "work_types": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
    },
    "required": ["summary", "target_titles", "industries", "keywords", "work_types"],
    "additionalProperties": False,
}


def suggest_career_strategy(resume_text: str) -> dict | None:
    """Suggests career-strategy form fields (target titles, industries, keywords,
    work types) grounded strictly in a resume's own content, so the onboarding
    strategy form can start pre-filled instead of blank. Returns None on a
    missing API key, empty resume text, or any failure -- there is deliberately
    no heuristic fallback here (see onboarding-redesign plan): guessing these
    fields without a real read of the resume risks being confidently wrong,
    which is worse than the caller falling back to its current blank form.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return None
    text = (resume_text or "").strip()
    if not text:
        return None
    prompt = (
        "Read this resume and suggest career-strategy fields for a job search, grounded only in what "
        "the resume actually shows. Never invent employers, titles, or experience the resume doesn't contain. "
        "target_titles should be roles this person is qualified for based on their actual background. "
        "industries should reflect industries they have real experience in. keywords are specific skills or "
        "specializations evidenced in the text. work_types should only include values actually implied "
        "(e.g. 'remote' if they've worked remotely) -- if nothing is implied, return an empty list.\n\n"
        f"RESUME:\n{text[:30000]}"
    )
    return ask_for_json(
        prompt,
        schema_name="career_strategy_suggestion",
        schema=_STRATEGY_SCHEMA,
        purpose="career strategy suggestion",
    )


def deterministic_career_strategy(resume_text: str) -> dict | None:
    """A zero-dependency fallback for when no OpenAI key is configured (or a
    call fails) -- reuses the rules-based resume parser's title/skill
    extraction instead of leaving the onboarding form blank.

    Narrower than the AI version on purpose: only role titles the parser
    found paired with an actual date range make it into target_titles, and
    industries/work_types/summary are left for the person to fill in rather
    than guessed from weaker signal. Returns None when the resume gave the
    parser nothing to work with, the same as the AI path with no key.
    """
    text = (resume_text or "").strip()
    if not text:
        return None
    parsed, _ = parse_resume(text)
    role_titles = parsed.get("role_titles") or []
    skills = parsed.get("skills") or []
    if not role_titles and not skills:
        return None
    return {
        "summary": "",
        "target_titles": role_titles[:5],
        "industries": [],
        "keywords": skills[:8],
        "work_types": [],
    }
