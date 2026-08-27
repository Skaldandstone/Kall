from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import (
    CareerProfile,
    DiscoverySchedule,
    Job,
    NotificationPreference,
    Opportunity,
    User,
)
from kall.services.ats_web_search import build_ats_queries
from kall.services.opportunities import mark_state
from kall.services.suppression import DISCOVERY_BLOCKING_REASONS, is_suppressed, suppressed_urls

router = APIRouter(tags=["opportunities"])


class ScheduleInput(BaseModel):
    professional_profile_id: int
    cadence: str = "daily"
    timezone: str = "UTC"
    hour_local: int = Field(default=8, ge=0, le=23)
    max_posting_age_days: int = Field(default=30, ge=1, le=90)


class OpportunityUpdate(BaseModel):
    state: str | None = None
    notes: str | None = None


class PreferenceInput(BaseModel):
    email_enabled: bool = True
    push_enabled: bool = False
    delivery_mode: str = "digest"
    digest_hour_local: int = Field(default=8, ge=0, le=23)
    timezone: str = "UTC"
    minimum_match_score: int = Field(default=60, ge=0, le=100)


def _owned_profile(profile_id: int, user_id: int, session: Session) -> CareerProfile:
    profile = session.get(CareerProfile, profile_id)
    if not profile or profile.user_id != user_id:
        raise HTTPException(404, "Professional profile not found")
    return profile


@router.get("/discovery/ats-search/{profile_id}")
def ats_search_plan(profile_id: int, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    profile = _owned_profile(profile_id, current.id, session)
    return {
        "professional_profile_id": profile.id,
        "profile_name": profile.name,
        "queries": build_ats_queries(profile),
    }


@router.post("/discovery/schedules", response_model=DiscoverySchedule)
def create_schedule(payload: ScheduleInput, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _owned_profile(payload.professional_profile_id, current.id, session)
    row = session.exec(
        select(DiscoverySchedule).where(
            DiscoverySchedule.user_id == current.id,
            DiscoverySchedule.professional_profile_id == payload.professional_profile_id,
        )
    ).first()
    if not row:
        row = DiscoverySchedule(
            user_id=current.id,
            professional_profile_id=payload.professional_profile_id,
        )
    row.cadence = payload.cadence
    row.timezone = payload.timezone
    row.run_at_local = datetime.min.replace(hour=payload.hour_local).time()
    row.max_posting_age_days = payload.max_posting_age_days
    row.enabled = True
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/discovery/schedules", response_model=list[DiscoverySchedule])
def list_schedules(current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return list(
        session.exec(
            select(DiscoverySchedule)
            .where(DiscoverySchedule.user_id == current.id)
            .order_by(DiscoverySchedule.updated_at.desc())
        )
    )


@router.get("/opportunities", response_model=list[Opportunity])
def list_opportunities(state: str | None = None, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    statement = select(Opportunity, Job.url).join(Job, Opportunity.job_id == Job.id).where(Opportunity.user_id == current.id)
    if state:
        statement = statement.where(Opportunity.state == state)
    rows = session.exec(statement.order_by(Opportunity.match_score.desc(), Opportunity.last_seen_at.desc())).all()
    # An opportunity can be created by one discovery run and only later
    # flagged dead_link -- suppressing a URL blocks future ingestion (see
    # discovery.py) but does nothing to a row that already exists. Without
    # this, a posting the user has explicitly said is dead keeps sitting in
    # their tracked inbox forever.
    blocked = suppressed_urls(session, current.id, reasons=DISCOVERY_BLOCKING_REASONS)
    return [opportunity for opportunity, url in rows if not is_suppressed(url, blocked)]


@router.patch("/opportunities/{opportunity_id}", response_model=Opportunity)
def update_opportunity(opportunity_id: int, payload: OpportunityUpdate, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    row = session.get(Opportunity, opportunity_id)
    if not row or row.user_id != current.id:
        raise HTTPException(404, "Opportunity not found")
    if payload.state:
        try:
            mark_state(row, payload.state)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if payload.notes is not None:
        row.notes = payload.notes
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/notification-preferences", response_model=NotificationPreference)
def get_preferences(current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """The current preference row, or the model's own defaults if none
    exists yet -- there is no separate "onboard into notifications" step,
    so most accounts have no row at all. jobs/daily_brief.py reads the
    same defaults when a row is absent; this just lets a settings page
    show them without first creating one.
    """
    row = session.exec(select(NotificationPreference).where(NotificationPreference.user_id == current.id)).first()
    return row or NotificationPreference(user_id=current.id)


@router.put("/notification-preferences", response_model=NotificationPreference)
def set_preferences(payload: PreferenceInput, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    row = session.exec(select(NotificationPreference).where(NotificationPreference.user_id == current.id)).first()
    if not row:
        row = NotificationPreference(user_id=current.id)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
