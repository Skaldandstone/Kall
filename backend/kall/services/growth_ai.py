
from kall.config import get_settings
from kall.models import CareerGoal
from kall.services.openai_json import ask_for_json


def _call_structured(prompt: str, schema: dict, schema_name: str) -> dict | None:
    """Calls OpenAI's Responses API with a strict JSON schema, mirroring the
    pattern in api_resume_intelligence.py's _ai_recommendations. Returns None
    on any failure (missing key, network error, bad response) so the caller
    can decide what deterministic fallback to use -- this function never
    raises and never guesses at partial data.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return None
    return ask_for_json(prompt, schema_name=schema_name, schema=schema, purpose="growth plan")


def _goal_context(goal: CareerGoal) -> str:
    fields = [
        f"Title: {goal.title}",
        f"Target role: {goal.target_role}",
        f"Target industry: {goal.target_industry or 'not specified'}",
        f"Current level: {goal.current_level or 'not specified'}",
        f"Target level: {goal.target_level or 'not specified'}",
        f"Time available per week: {goal.time_per_week_hours or 'not specified'} hours",
        f"Budget preference: {goal.budget_preference or 'not specified'}",
        f"Notes: {goal.notes or 'none'}",
    ]
    return "\n".join(fields)


_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "current_strengths": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
        "skill_gaps": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
        "recommended_roles": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
        "milestones": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "properties": {
                    "phase": {"type": "string"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "category": {"type": "string"},
                    "estimated_hours": {"type": "integer", "minimum": 1, "maximum": 400},
                },
                "required": ["phase", "title", "description", "category", "estimated_hours"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "current_strengths", "skill_gaps", "recommended_roles", "milestones"],
    "additionalProperties": False,
}


def generate_ai_plan(goal: CareerGoal, resume_text: str) -> dict | None:
    prompt = (
        "Build a concrete, realistic career growth plan for someone pursuing the target role below. "
        "Never invent credentials, employers, or experience the person hasn't described. "
        "Milestones must be specific and actionable, ordered from foundational to market-ready, "
        "and paced against the stated weekly time budget.\n\n"
        f"GOAL:\n{_goal_context(goal)}\n\n"
        f"CANDIDATE BACKGROUND (may be empty):\n{resume_text[:30000]}"
    )
    return _call_structured(prompt, _PLAN_SCHEMA, "career_growth_plan")


_SKILLS_SCHEMA = {
    "type": "object",
    "properties": {
        "readiness_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "narrative": {"type": "string"},
        "applicable_skills": {
            "type": "array",
            "maxItems": 8,
            "items": {
                "type": "object",
                "properties": {
                    "skill": {"type": "string"},
                    "how_it_applies": {"type": "string"},
                },
                "required": ["skill", "how_it_applies"],
                "additionalProperties": False,
            },
        },
        "gaps": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
    },
    "required": ["readiness_score", "narrative", "applicable_skills", "gaps"],
    "additionalProperties": False,
}


def analyze_skills(goal: CareerGoal, answer_text: str, resume_text: str) -> dict | None:
    prompt = (
        "Assess how this person's current skills and background transfer toward their target role. "
        "Ground every claim only in what is actually stated below -- never invent credentials, "
        "certifications, or experience. Be specific about how each existing skill applies to the target role, "
        "and name concrete gaps rather than generic advice.\n\n"
        f"GOAL:\n{_goal_context(goal)}\n\n"
        f"THEIR OWN DESCRIPTION OF CURRENT SKILLS:\n{answer_text}\n\n"
        f"STORED RESUME (may be empty):\n{resume_text[:30000]}"
    )
    return _call_structured(prompt, _SKILLS_SCHEMA, "career_skill_assessment")
