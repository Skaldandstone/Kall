from datetime import date, datetime, timedelta
from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, HttpUrl
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import (
    CareerGoal,
    CareerGrowthPlan,
    GrowthMilestone,
    GrowthProgressEntry,
    GrowthResource,
    GrowthSearchQuery,
    GrowthSkillAssessment,
    ResumeDocument,
    User,
)
from kall.services.growth_ai import analyze_skills, generate_ai_plan

router = APIRouter()


class GoalCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    target_role: str = Field(min_length=2, max_length=120)
    target_industry: str | None = None
    current_level: str | None = None
    target_level: str | None = None
    target_date: date | None = None
    time_per_week_hours: int | None = Field(default=None, ge=1, le=80)
    budget_preference: str | None = None
    notes: str | None = None


class ProgressCreate(BaseModel):
    milestone_id: int | None = None
    note: str = Field(min_length=2, max_length=1000)
    evidence_url: str | None = None


class PlanGenerateRequest(BaseModel):
    regenerate: bool = False


class SkillsAnalysisRequest(BaseModel):
    answer: str = Field(min_length=2, max_length=5000)


class ResourceImportRequest(BaseModel):
    url: HttpUrl
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=2000)


class ResourcePinRequest(BaseModel):
    saved: bool


def _owned_goal(session: Session, user_id: int, goal_id: int) -> CareerGoal:
    goal = session.get(CareerGoal, goal_id)
    if not goal or goal.user_id != user_id:
        raise HTTPException(404, "Career goal not found")
    return goal


def _default_resume_text(session: Session, user_id: int) -> str:
    resume = session.exec(
        select(ResumeDocument).where(ResumeDocument.user_id == user_id, ResumeDocument.is_default)
    ).first()
    if not resume:
        resume = session.exec(
            select(ResumeDocument).where(ResumeDocument.user_id == user_id).order_by(ResumeDocument.updated_at.desc())
        ).first()
    return (resume.extracted_text or "") if resume else ""


def _plan_payload(session: Session, plan: CareerGrowthPlan) -> dict:
    milestones = list(session.exec(select(GrowthMilestone).where(GrowthMilestone.growth_plan_id == plan.id).order_by(GrowthMilestone.sequence)))
    resources = list(session.exec(select(GrowthResource).where(GrowthResource.growth_plan_id == plan.id).order_by(GrowthResource.saved.desc())))
    searches = list(session.exec(select(GrowthSearchQuery).where(GrowthSearchQuery.growth_plan_id == plan.id)))
    progress = list(session.exec(select(GrowthProgressEntry).where(GrowthProgressEntry.growth_plan_id == plan.id).order_by(GrowthProgressEntry.occurred_at.desc())))
    assessments = list(session.exec(select(GrowthSkillAssessment).where(GrowthSkillAssessment.career_goal_id == plan.career_goal_id).order_by(GrowthSkillAssessment.created_at.desc())))
    return {"plan": plan, "milestones": milestones, "resources": resources, "searches": searches, "progress": progress, "skill_assessments": assessments}


@router.get("/growth")
def growth_dashboard(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    goals = list(session.exec(select(CareerGoal).where(CareerGoal.user_id == current_user.id).order_by(CareerGoal.updated_at.desc())))
    plans = list(session.exec(select(CareerGrowthPlan).where(CareerGrowthPlan.user_id == current_user.id).order_by(CareerGrowthPlan.generated_at.desc())))
    plan_by_goal = {plan.career_goal_id: plan for plan in plans}
    return {
        "goals": [
            {
                "goal": goal,
                "plan": _plan_payload(session, plan_by_goal[goal.id]) if goal.id in plan_by_goal else None,
            }
            for goal in goals
        ]
    }


@router.post("/growth/goals", response_model=CareerGoal)
def create_goal(payload: GoalCreate, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> CareerGoal:
    goal = CareerGoal(user_id=current_user.id, **payload.model_dump())
    session.add(goal)
    session.commit()
    session.refresh(goal)
    return goal


def _deterministic_plan_content(goal: CareerGoal) -> dict:
    role = goal.target_role.strip()
    industry = (goal.target_industry or "your target industry").strip()
    hours = goal.time_per_week_hours or 5
    return {
        "summary": f"A practical path toward {role} in {industry}, paced around roughly {hours} hours per week.",
        "current_strengths": ["Existing professional experience", "Transferable accomplishments", "Defined career direction"],
        "skill_gaps": [f"Role-specific skills for {role}", f"Industry context for {industry}", "Portfolio or evidence aligned to the target role"],
        "recommended_roles": [role, f"Associate {role}", f"Senior {role}"],
        "milestones": [
            {"phase": "Foundation", "title": "Map the role", "description": f"Review current {role} postings and identify recurring skills, tools, and portfolio expectations.", "category": "research", "estimated_hours": 4},
            {"phase": "Capability", "title": "Close the highest-value gap", "description": f"Complete one focused learning project that demonstrates a core {role} capability.", "category": "education", "estimated_hours": max(8, hours * 3)},
            {"phase": "Evidence", "title": "Build proof of work", "description": f"Create or refine a portfolio artifact, case study, or achievement story relevant to {industry}.", "category": "portfolio", "estimated_hours": max(10, hours * 4)},
            {"phase": "Market", "title": "Enter the conversation", "description": f"Connect with practitioners, request feedback, and begin targeted applications for {role} positions.", "category": "networking", "estimated_hours": 6},
        ],
    }


def _search_queries(goal: CareerGoal) -> list[tuple[str, str, str]]:
    role = goal.target_role.strip()
    industry = (goal.target_industry or "your target industry").strip()
    return [
        ("roles", f"{role} jobs {industry}", "Study real job requirements and vocabulary."),
        ("learning", f"best courses for {role} {industry}", "Find focused education options."),
        ("portfolio", f"{role} portfolio examples {industry}", "See credible proof-of-work examples."),
        ("community", f"{role} professional community {industry}", "Locate peers, mentors, and professional groups."),
    ]


@router.post("/growth/goals/{goal_id}/plan")
def generate_plan(goal_id: int, payload: PlanGenerateRequest = PlanGenerateRequest(), current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    goal = _owned_goal(session, current_user.id, goal_id)
    existing = session.exec(select(CareerGrowthPlan).where(CareerGrowthPlan.career_goal_id == goal.id)).first()
    if existing and not payload.regenerate:
        return _plan_payload(session, existing)

    resume_text = _default_resume_text(session, current_user.id)
    ai_content = generate_ai_plan(goal, resume_text)
    content = ai_content or _deterministic_plan_content(goal)
    provider = "openai" if ai_content else "deterministic"
    provider_version = "growth-plan-ai-v1" if ai_content else "growth-plan-v1"

    if existing:
        plan = existing
        old_milestones = list(session.exec(select(GrowthMilestone).where(GrowthMilestone.growth_plan_id == plan.id)))
        old_milestone_ids = {milestone.id for milestone in old_milestones}
        if old_milestone_ids:
            for entry in session.exec(select(GrowthProgressEntry).where(GrowthProgressEntry.milestone_id.in_(old_milestone_ids))):
                entry.milestone_id = None
                session.add(entry)
        for milestone in old_milestones:
            session.delete(milestone)
        for search in session.exec(select(GrowthSearchQuery).where(GrowthSearchQuery.growth_plan_id == plan.id)):
            session.delete(search)
        plan.summary = content["summary"]
        plan.current_strengths = content["current_strengths"]
        plan.skill_gaps = content["skill_gaps"]
        plan.recommended_roles = content["recommended_roles"]
        plan.provider = provider
        plan.provider_version = provider_version
        plan.generated_at = datetime.utcnow()
        session.add(plan)
    else:
        plan = CareerGrowthPlan(
            user_id=current_user.id,
            career_goal_id=goal.id,
            provider=provider,
            provider_version=provider_version,
            summary=content["summary"],
            current_strengths=content["current_strengths"],
            skill_gaps=content["skill_gaps"],
            recommended_roles=content["recommended_roles"],
        )
        session.add(plan)
    session.commit()
    session.refresh(plan)

    for sequence, milestone in enumerate(content["milestones"], start=1):
        session.add(GrowthMilestone(
            user_id=current_user.id,
            growth_plan_id=plan.id,
            sequence=sequence,
            phase=milestone["phase"],
            title=milestone["title"],
            description=milestone["description"],
            category=milestone["category"],
            target_date=(datetime.utcnow() + timedelta(days=sequence * 30)).date(),
            estimated_hours=milestone.get("estimated_hours"),
        ))

    for category, query, rationale in _search_queries(goal):
        session.add(GrowthSearchQuery(
            user_id=current_user.id,
            growth_plan_id=plan.id,
            category=category,
            query=query,
            search_url=f"https://www.google.com/search?q={quote_plus(query)}",
            rationale=rationale,
        ))

    session.commit()
    session.refresh(plan)
    return _plan_payload(session, plan)


@router.post("/growth/goals/{goal_id}/skills-analysis", response_model=GrowthSkillAssessment)
def create_skills_analysis(goal_id: int, payload: SkillsAnalysisRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> GrowthSkillAssessment:
    goal = _owned_goal(session, current_user.id, goal_id)
    resume_text = _default_resume_text(session, current_user.id)
    ai_result = analyze_skills(goal, payload.answer, resume_text)
    if ai_result:
        assessment = GrowthSkillAssessment(
            user_id=current_user.id,
            career_goal_id=goal.id,
            answer_text=payload.answer,
            applicable_skills=ai_result["applicable_skills"],
            gaps=ai_result["gaps"],
            readiness_score=ai_result["readiness_score"],
            narrative=ai_result["narrative"],
            provider="openai",
        )
    else:
        role = goal.target_role.strip()
        assessment = GrowthSkillAssessment(
            user_id=current_user.id,
            career_goal_id=goal.id,
            answer_text=payload.answer,
            applicable_skills=[],
            gaps=[f"Role-specific skills for {role}", "Portfolio or evidence aligned to the target role"],
            readiness_score=40,
            narrative="AI analysis is not available right now, so this is a general starting estimate. Add specific detail about your background, or try again shortly for a personalized assessment.",
            provider="deterministic",
        )
    session.add(assessment)
    session.commit()
    session.refresh(assessment)
    return assessment


@router.post("/growth/plans/{plan_id}/resources", response_model=GrowthResource)
def import_resource(plan_id: int, payload: ResourceImportRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> GrowthResource:
    plan = session.get(CareerGrowthPlan, plan_id)
    if not plan or plan.user_id != current_user.id:
        raise HTTPException(404, "Growth plan not found")
    resource = GrowthResource(
        user_id=current_user.id,
        growth_plan_id=plan.id,
        resource_type="web_search_result",
        title=payload.title,
        provider="web",
        url=str(payload.url),
        description=payload.description,
        saved=False,
    )
    session.add(resource)
    session.commit()
    session.refresh(resource)
    return resource


@router.patch("/growth/resources/{resource_id}", response_model=GrowthResource)
def pin_resource(resource_id: int, payload: ResourcePinRequest, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> GrowthResource:
    resource = session.get(GrowthResource, resource_id)
    if not resource or resource.user_id != current_user.id:
        raise HTTPException(404, "Resource not found")
    resource.saved = payload.saved
    session.add(resource)
    session.commit()
    session.refresh(resource)
    return resource


@router.post("/growth/plans/{plan_id}/progress", response_model=GrowthProgressEntry)
def add_progress(plan_id: int, payload: ProgressCreate, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> GrowthProgressEntry:
    plan = session.get(CareerGrowthPlan, plan_id)
    if not plan or plan.user_id != current_user.id:
        raise HTTPException(404, "Growth plan not found")
    if payload.milestone_id:
        milestone = session.get(GrowthMilestone, payload.milestone_id)
        if not milestone or milestone.growth_plan_id != plan.id:
            raise HTTPException(404, "Milestone not found")
    entry = GrowthProgressEntry(
        user_id=current_user.id,
        growth_plan_id=plan.id,
        milestone_id=payload.milestone_id,
        entry_type="note",
        note=payload.note,
        evidence_url=payload.evidence_url,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry
