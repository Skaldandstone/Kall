
from kall.config import get_settings
from kall.services.functional_areas import FUNCTIONAL_AREA_ALIASES, functional_area_evidence
from kall.services.intelligence import parse_resume
from kall.services.openai_json import ask_for_json

_STRATEGY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "profile_name": {"type": "string"},
        "target_titles": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
        "functional_areas": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
        "industries": {"type": "array", "maxItems": 5, "items": {"type": "string"}},
        "keywords": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
        "work_types": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
        "pay_basis": {"type": "string", "enum": ["hourly", "salary"]},
        "suggested_salary_min": {"type": ["integer", "null"]},
        "suggested_salary_max": {"type": ["integer", "null"]},
    },
    "required": [
        "summary",
        "profile_name",
        "target_titles",
        "functional_areas",
        "industries",
        "keywords",
        "work_types",
        "pay_basis",
        "suggested_salary_min",
        "suggested_salary_max",
    ],
    "additionalProperties": False,
}


def suggest_career_strategy(resume_text: str) -> dict | None:
    """Suggests career-strategy form fields (profile name, target titles,
    industries, keywords, work types, a rough pay estimate) grounded strictly
    in a resume's own content, so the onboarding strategy form can start
    pre-filled instead of blank. Returns None on a missing API key, empty
    resume text, or any failure -- there is deliberately no heuristic fallback
    here (see onboarding-redesign plan): guessing these fields without a real
    read of the resume risks being confidently wrong, which is worse than the
    caller falling back to its current blank form.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return None
    text = (resume_text or "").strip()
    if not text:
        return None
    prompt = (
        "Read this resume and suggest career-strategy fields for a job search, grounded only in what "
        "the resume actually shows. Never invent employers, titles, or experience the resume doesn't contain.\n\n"
        "profile_name is a short label (2-5 words) for this search strategy, like 'Quality Leadership' or "
        "'Senior Backend Engineering' -- named after the role/direction, not the person.\n\n"
        "target_titles should be roles this person is qualified for based on their actual background. Include "
        "close synonyms and common abbreviations of the same role alongside the full title -- for example, "
        "if the resume supports 'Director of Quality Engineering', also include 'Director of QE' and "
        "'Director of Quality Assurance' if that is a real equivalent in their field, since a job board search "
        "matches on exact title text and postings phrase the same role differently.\n\n"
        "functional_areas are the job functions this person's work falls under. Choose only from this "
        f"list, up to four, most relevant first: {', '.join(FUNCTIONAL_AREA_ALIASES)}. Return an empty list "
        "if none of them fit.\n\n"
        "industries must each be a short, canonical, widely-recognized industry name (1-3 words, e.g. 'SaaS', "
        "'FinTech', 'Healthcare', 'E-Commerce', 'Manufacturing') -- never a descriptive phrase or sentence "
        "fragment. These are compared as literal substrings against real job posting text to confirm a match, "
        "so a phrase like 'Advertising technology and ad serving' will never match anything; 'AdTech' will. "
        "Prefer the single most common industry term over a compound one when they overlap.\n\n"
        "keywords are specific skills or specializations evidenced in the text. work_types should only include "
        "values actually implied (e.g. 'remote' if they've worked remotely) -- if nothing is implied, return an "
        "empty list.\n\n"
        "pay_basis is 'hourly' only if the resume explicitly describes hourly or contract work; otherwise use "
        "'salary'. Always set suggested_salary_min and suggested_salary_max to null. Kall has no verified market "
        "compensation source in this request, so do not manufacture a market-rate estimate from model memory.\n\n"
        f"RESUME:\n{text[:30000]}"
    )
    result = ask_for_json(
        prompt,
        schema_name="career_strategy_suggestion",
        schema=_STRATEGY_SCHEMA,
        purpose="career strategy suggestion",
        source_ref="uploaded-resume:unversioned",
    )
    if result is not None:
        # Keep the model inside the vocabulary the search actually expands on,
        # and fall back to the evidence-based read when it offered nothing.
        known = {label.casefold(): label for label in FUNCTIONAL_AREA_ALIASES}
        chosen = [known[str(value).casefold()] for value in result.get("functional_areas") or [] if str(value).casefold() in known]
        result["functional_areas"] = list(dict.fromkeys(chosen)) or infer_functional_areas(text)
    return result


def infer_functional_areas(resume_text: str, limit: int = 4) -> list[str]:
    """Functional areas whose known role phrases appear in the resume text,
    most frequently mentioned first. Purely lexical: it offers the areas the
    person can then approve or ignore, it never assigns them."""
    text = (resume_text or "").strip()
    if not text:
        return []
    scored: list[tuple[int, int, str]] = []
    for index, label in enumerate(FUNCTIONAL_AREA_ALIASES):
        hit = functional_area_evidence(text, [label])
        if not hit:
            continue
        _, phrase = hit
        count = text.casefold().count(phrase.casefold())
        scored.append((-count, index, label))
    return [label for _, _, label in sorted(scored)[:limit]]


def deterministic_career_strategy(resume_text: str) -> dict | None:
    """A zero-dependency fallback for when no OpenAI key is configured (or a
    call fails) -- reuses the rules-based resume parser's title/skill
    extraction instead of leaving the onboarding form blank.

    Narrower than the AI version on purpose: only role titles the parser
    found paired with an actual date range make it into target_titles, and
    industries/work_types/summary/pay estimate are left for the person to
    fill in rather than guessed from weaker signal. Returns None when the
    resume gave the parser nothing to work with, the same as the AI path
    with no key.
    """
    text = (resume_text or "").strip()
    if not text:
        return None
    parsed, _ = parse_resume(text)
    role_titles = parsed.get("role_titles") or []
    skills = parsed.get("skills") or []
    areas = infer_functional_areas(text)
    if not role_titles and not skills and not areas:
        return None
    return {
        "summary": "",
        "profile_name": role_titles[0] if role_titles else "",
        "target_titles": role_titles[:5],
        "functional_areas": areas,
        "industries": [],
        "keywords": skills[:8],
        "work_types": [],
        "pay_basis": "salary",
        "suggested_salary_min": None,
        "suggested_salary_max": None,
    }
