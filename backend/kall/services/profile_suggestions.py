"""AI-assisted suggestions for evidence-supported CareerProfile fields.

Compensation is deliberately excluded. Kall has no verified market-data
source, so a model-generated salary number would be unsupported precision.
People set compensation themselves until a reviewed source is integrated.

`deterministic_field_suggestions` below is the Free-tier path (SSE-206):
rules-based only, no LLM call and no ai_actions quota involved, since it
never calls the model at all. `suggest_empty_fields` is the AI-assisted
path used on Plus and Premium.
"""

from kall.config import get_settings
from kall.services.functional_areas import FUNCTIONAL_AREA_ALIASES, normalized_phrase
from kall.services.intelligence import employment_history
from kall.services.openai_json import ask_for_json

_FIELD_SCHEMAS = {
    "target_titles": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
    "industries": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
    "functional_areas": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
    "work_types": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
    "countries": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
}


def _profile_context(profile) -> str:
    fields = [
        f"Target titles: {', '.join(profile.target_titles) or 'not specified'}",
        f"Industries: {', '.join(profile.industries) or 'not specified'}",
        f"Functional areas: {', '.join(profile.functional_areas) or 'not specified'}",
        f"Countries: {', '.join(profile.countries) or 'not specified'}",
        f"States/regions: {', '.join(profile.states_regions) or 'not specified'}",
        f"Work types: {', '.join(profile.work_types) or 'not specified'}",
    ]
    return "\n".join(fields)


def suggest_empty_fields(profile, empty_fields: list[str], resume_text: str) -> dict | None:
    """Returns {field: value, ...} for the requested empty_fields plus a
    "rationale" string, or None if AI is unavailable or the call fails.
    Only ever asked about fields that are currently empty -- it never
    overwrites something the person already entered.
    """
    if not empty_fields:
        return None
    settings = get_settings()
    if not settings.openai_api_key:
        return None

    schema = {
        "type": "object",
        "properties": {field: _FIELD_SCHEMAS[field] for field in empty_fields} | {"rationale": {"type": "string"}},
        "required": [*empty_fields, "rationale"],
        "additionalProperties": False,
    }
    prompt = (
        "Suggest reasonable, realistic values for the listed empty fields on this person's career "
        "search profile, based on their existing profile choices and resume below. "
        "Only address the fields named in the schema. Never invent employers or credentials.\n\n"
        + f"CURRENT PROFILE:\n{_profile_context(profile)[:5000]}\n\n"
        f"RESUME (may be empty):\n{resume_text[:30000]}"
    )
    return ask_for_json(
        prompt,
        schema_name="profile_field_suggestions",
        schema=schema,
        purpose="profile_field_suggestions",
        source_ref=f"career-profile:{profile.id}",
    )


_WORK_TYPE_TERMS: dict[str, tuple[str, ...]] = {
    "Remote": ("remote", "work from home", "distributed team"),
    "Hybrid": ("hybrid",),
    "On-site": ("on-site", "onsite", "in-office", "in office"),
}


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.replace("\r", "").split("\n") if line.strip()]


def deterministic_field_suggestions(empty_fields: list[str], resume_text: str) -> dict[str, list[str]]:
    """Rules-based suggestions for the fields `suggest_empty_fields` would
    otherwise ask a model for -- no LLM call, so no ai_actions quota applies.

    Only ever proposes a field when the resume text contains actual
    supporting evidence; an empty result for a field is better than an
    invented one. `industries` and `countries` have no reliable rules-based
    signal in this codebase (an industry taxonomy and an address parser,
    respectively, do not exist here), so they are never guessed -- the same
    "never invent" stance the AI path already takes for compensation.
    """
    suggestions: dict[str, list[str]] = {}
    if not resume_text:
        return suggestions
    haystack = f" {normalized_phrase(resume_text)} "

    if "target_titles" in empty_fields:
        titles, _ = employment_history(_lines(resume_text))
        if titles:
            suggestions["target_titles"] = titles[:6]

    if "functional_areas" in empty_fields:
        found = [
            area for area, aliases in FUNCTIONAL_AREA_ALIASES.items()
            if any(f" {normalized_phrase(term)} " in haystack for term in (area, *aliases))
        ]
        if found:
            suggestions["functional_areas"] = found[:4]

    if "work_types" in empty_fields:
        found = [
            label for label, terms in _WORK_TYPE_TERMS.items()
            if any(f" {normalized_phrase(term)} " in haystack for term in terms)
        ]
        if found:
            suggestions["work_types"] = found[:3]

    return suggestions
