"""AI-assisted suggestions for empty CareerProfile fields.

Mirrors the ask_for_json + graceful-None-on-failure pattern used by
growth_ai and onboarding_ai. Compensation numbers are the model's own
estimate from its training data, not a paid market-data lookup (no such
integration exists in this codebase -- see docs/ROADMAP.md) -- so this
never invents a number for a field the profile already has, and the
schema only asks about fields that are actually empty.
"""

from kall.config import get_settings
from kall.services.openai_json import ask_for_json

_FIELD_SCHEMAS = {
    "target_titles": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
    "industries": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
    "functional_areas": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
    "work_types": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
    "countries": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
    "minimum_base": {"type": "integer", "minimum": 0},
    "target_base": {"type": "integer", "minimum": 0},
    "stretch_base": {"type": "integer", "minimum": 0},
    "minimum_total_comp": {"type": "integer", "minimum": 0},
    "target_total_comp": {"type": "integer", "minimum": 0},
    "target_bonus_percent": {"type": "number", "minimum": 0},
}

_COMPENSATION_FIELDS = {
    "minimum_base", "target_base", "stretch_base",
    "minimum_total_comp", "target_total_comp", "target_bonus_percent",
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
    wants_compensation = any(field in _COMPENSATION_FIELDS for field in empty_fields)
    prompt = (
        "Suggest reasonable, realistic values for the listed empty fields on this person's career "
        "search profile, based on their existing profile choices and resume below. "
        "Only address the fields named in the schema. Never invent employers or credentials.\n\n"
        + ("Compensation figures are your own best estimate of typical U.S. market pay for this "
           "role, seniority, and location from your training knowledge -- not verified market data. "
           "Say so plainly in the rationale, and keep target figures realistic for the person's "
           "apparent seniority rather than optimistic.\n\n" if wants_compensation else "")
        + f"CURRENT PROFILE:\n{_profile_context(profile)}\n\n"
        f"RESUME (may be empty):\n{resume_text[:30000]}"
    )
    return ask_for_json(prompt, schema_name="profile_field_suggestions", schema=schema, purpose="profile_field_suggestions")
