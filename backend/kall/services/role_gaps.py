"""What each role is missing against a posting, with a suggested bullet.

For every job in the professional record, the posting's requirements that
the role's own text never mentions are the gaps. Each gap becomes a
suggestion -- a bullet the person could add *if it is true* -- that they
approve, edit, or reject one at a time or all at once. Nothing is written
into the resume without that decision; the suggestion's job is to ask the
right question, not to answer it for them.
"""

from dataclasses import dataclass, field

from kall.config import get_settings
from kall.services.openai_json import ask_for_json

MAX_GAPS_PER_ROLE = 3
MAX_ROLES = 5


@dataclass
class RoleContext:
    employment_id: int
    employer: str
    title: str
    dates: str
    text: str
    bullets: list[str] = field(default_factory=list)


@dataclass
class RoleGap:
    employment_id: int
    employer: str
    title: str
    requirement: str
    prompt: str
    suggestion: str
    source: str  # "model" | "rules"


def _mentions(text: str, requirement: str) -> bool:
    return requirement.casefold() in text.casefold()


def find_gaps(roles: list[RoleContext], requirements: list[str], resume_text: str) -> dict[int, list[str]]:
    """Requirements each role does not mention. Requirements the whole resume
    never mentions come first, since those are the ones costing the match."""
    unsupported = [item for item in requirements if not _mentions(resume_text, item)]
    supported = [item for item in requirements if item not in unsupported]
    gaps: dict[int, list[str]] = {}
    for role in roles[:MAX_ROLES]:
        haystack = " ".join([role.text, *role.bullets])
        missing = [item for item in [*unsupported, *supported] if item and not _mentions(haystack, item)]
        if missing:
            gaps[role.employment_id] = missing[:MAX_GAPS_PER_ROLE]
    return gaps


def _rules_suggestion(role: RoleContext, requirement: str) -> str:
    return f"Used {requirement} as {role.title} at {role.employer} to [describe the outcome and its scale]."


def _rules_prompt(role: RoleContext, requirement: str) -> str:
    return f"The posting asks for {requirement}. Did your work as {role.title} at {role.employer} involve it?"


_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "employment_id": {"type": "integer"},
                    "requirement": {"type": "string"},
                    "prompt": {"type": "string"},
                    "bullet": {"type": "string"},
                },
                "required": ["employment_id", "requirement", "prompt", "bullet"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}


def suggest_role_gaps(job_title: str, company: str, roles: list[RoleContext], gaps: dict[int, list[str]]) -> list[RoleGap]:
    """One suggestion per gap. A single model call drafts every bullet at once
    when a key is configured; otherwise the rules-based phrasing stands in.
    Model output is trimmed to the gaps that were actually asked about, so it
    can never introduce a requirement or a role of its own."""
    by_id = {role.employment_id: role for role in roles}
    results: list[RoleGap] = []
    drafted: dict[tuple[int, str], tuple[str, str]] = {}
    if get_settings().openai_api_key and gaps:
        listing = []
        for employment_id, requirements in gaps.items():
            role = by_id[employment_id]
            listing.append(
                f"employment_id={employment_id}; title={role.title}; employer={role.employer}; dates={role.dates}; "
                f"what the resume says: {role.text[:600]}; missing requirements: {'; '.join(requirements)}"
            )
        prompt = (
            f"A job seeker is tailoring their resume for '{job_title}' at {company}. For each role below and each "
            "missing requirement, write (1) a one-sentence question asking whether their work in that role actually "
            "involved the requirement, and (2) a draft resume bullet, 12-25 words, past tense, that they could use IF "
            "they answer yes. Never invent metrics, tools, or outcomes: where a number belongs, write [X]. Return "
            "exactly one entry per (employment_id, requirement) pair listed.\n\n" + "\n\n".join(listing)
        )
        source_ids = ",".join(str(value) for value in sorted(gaps))
        result = ask_for_json(
            prompt,
            schema_name="role_gap_suggestions",
            schema=_SCHEMA,
            purpose="role gap suggestions",
            source_ref=f"employment:{source_ids}",
        )
        for item in (result or {}).get("suggestions", []):
            key = (int(item.get("employment_id", 0)), str(item.get("requirement", "")).strip())
            if key[0] in gaps and any(req.casefold() == key[1].casefold() for req in gaps[key[0]]):
                drafted[(key[0], key[1].casefold())] = (str(item.get("prompt", "")).strip(), str(item.get("bullet", "")).strip())
    for employment_id, requirements in gaps.items():
        role = by_id[employment_id]
        for requirement in requirements:
            prompt_text, bullet = drafted.get((employment_id, requirement.casefold()), ("", ""))
            results.append(
                RoleGap(
                    employment_id=employment_id,
                    employer=role.employer,
                    title=role.title,
                    requirement=requirement,
                    prompt=prompt_text or _rules_prompt(role, requirement),
                    suggestion=bullet or _rules_suggestion(role, requirement),
                    source="model" if bullet else "rules",
                )
            )
    return results
