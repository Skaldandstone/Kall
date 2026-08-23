import json

import httpx
from kall.config import get_settings
from kall.models import CareerGoal


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
    try:
        response = httpx.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
            json={
                "model": settings.openai_model,
                "input": prompt,
                "text": {"format": {"type": "json_schema", "name": schema_name, "strict": True, "schema": schema}},
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
        return json.loads(output_text or "{}")
    except Exception:
        return None


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
