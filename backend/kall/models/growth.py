from datetime import date, datetime
from typing import Any

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin


class CareerGoal(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    title: str
    target_role: str = Field(index=True)
    target_industry: str | None = Field(default=None, index=True)
    goal_type: str = "career_change"
    current_level: str | None = None
    target_level: str | None = None
    target_date: date | None = None
    location_preference: str | None = None
    time_per_week_hours: int | None = None
    budget_preference: str | None = None
    notes: str | None = None
    status: str = "active"


class CareerGrowthPlan(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    career_goal_id: int = Field(index=True, foreign_key="careergoal.id")
    provider: str = "deterministic"
    provider_version: str = "growth-plan-v1"
    status: str = "active"
    summary: str
    current_strengths: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    skill_gaps: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    recommended_roles: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    generated_at: datetime = Field(default_factory=datetime.utcnow)


class GrowthMilestone(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    growth_plan_id: int = Field(index=True, foreign_key="careergrowthplan.id")
    sequence: int
    phase: str
    title: str
    description: str
    category: str
    target_date: date | None = None
    estimated_hours: int | None = None
    status: str = "not_started"
    completed_at: datetime | None = None


class GrowthResource(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    growth_plan_id: int = Field(index=True, foreign_key="careergrowthplan.id")
    milestone_id: int | None = Field(default=None, foreign_key="growthmilestone.id")
    resource_type: str
    title: str
    provider: str | None = None
    url: str
    description: str | None = None
    cost_type: str | None = None
    difficulty: str | None = None
    estimated_hours: int | None = None
    saved: bool = False
    completed: bool = False
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class GrowthSearchQuery(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    growth_plan_id: int = Field(index=True, foreign_key="careergrowthplan.id")
    category: str
    query: str
    search_url: str
    rationale: str
    last_run_at: datetime | None = None


class GrowthProgressEntry(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    growth_plan_id: int = Field(index=True, foreign_key="careergrowthplan.id")
    milestone_id: int | None = Field(default=None, foreign_key="growthmilestone.id")
    entry_type: str
    note: str
    evidence_url: str | None = None
    occurred_at: datetime = Field(default_factory=datetime.utcnow)


class GrowthSkillAssessment(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    career_goal_id: int = Field(index=True, foreign_key="careergoal.id")
    answer_text: str
    applicable_skills: list[dict[str, str]] = Field(default_factory=list, sa_column=Column(JSON))
    gaps: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    readiness_score: int
    narrative: str
    provider: str = "deterministic"
