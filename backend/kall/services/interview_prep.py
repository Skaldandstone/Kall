"""Interview question bank, per application.

Nothing helped someone prepare for an interview before this -- no question
bank, no place to jot notes. This is the first cut per docs/ROADMAP.md's
scoped-down version: an AI-generated question bank against the job's own
title/company/requirements, falling back to a fixed general list when no AI
key is configured, plus free-text notes. Mock-interview practice (Final
Round AI's whole business) is a larger follow-on, not part of this.
"""

from kall.config import get_settings
from kall.models import Job, JobRequirementAnalysis
from kall.services.openai_json import ask_for_json

FALLBACK_QUESTIONS = [
    "Tell me about yourself and what draws you to this role.",
    "Walk me through a project you're proud of and your specific contribution.",
    "Describe a time you disagreed with a teammate or manager. How did you handle it?",
    "Tell me about a mistake you made and what you learned from it.",
    "Why this company, and why this role specifically?",
    "Where do you want your career to be in a few years?",
]

_MAX_QUESTIONS = 10


def generate_questions(job: Job, analysis: JobRequirementAnalysis | None) -> tuple[list[str], bool]:
    """Likely interview questions for `job`, or FALLBACK_QUESTIONS if AI is
    not configured or fails -- the same "silence is not an option" rule
    services/openai_json.py exists to enforce elsewhere.

    Returns (questions, used_ai) -- the caller needs to know whether an AI
    call actually happened, the same way api_growth.py's generate_plan only
    calls quota.record_ai_action() when the AI path was genuinely taken and
    not when a free deterministic fallback was used instead.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return FALLBACK_QUESTIONS, False

    schema = {
        "type": "object",
        "properties": {
            "questions": {"type": "array", "maxItems": _MAX_QUESTIONS, "items": {"type": "string"}},
        },
        "required": ["questions"],
        "additionalProperties": False,
    }
    requirements = ", ".join((analysis.required_skills if analysis else [])[:10]) or "not specified"
    prompt = (
        f"Generate likely interview questions for a {job.title} role at {job.company}. "
        f"Key requirements: {requirements}. Mix behavioral and role-specific technical questions. "
        "Return only the questions themselves, no answers or commentary."
    )
    parsed = ask_for_json(
        prompt, schema_name="interview_questions", schema=schema, purpose="interview prep questions",
    )
    if parsed is None:
        return FALLBACK_QUESTIONS, False
    questions = [q for q in parsed.get("questions", []) if isinstance(q, str) and q.strip()]
    return (questions[:_MAX_QUESTIONS], True) if questions else (FALLBACK_QUESTIONS, False)
