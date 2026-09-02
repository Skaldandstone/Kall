from datetime import datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models import (
    CareerProfile,
    DiscoverySchedule,
    Job,
    NotificationDelivery,
    NotificationPreference,
    Opportunity,
    User,
)
from kall.models.monitoring import PublicBoardFeed, ScheduleBoardState
from kall.providers.board_feed import feed_key
from kall.services import work_claims
from kall.services.ats_web_search import build_ats_queries
from kall.services.matching import is_out_of_scope
from kall.services.monitoring import continuous_schedules, sources_for, validate_capacity
from kall.services.opportunities import mark_state
from kall.services.opportunity_notifications import OPPORTUNITY_KINDS
from kall.services.suppression import DISCOVERY_BLOCKING_REASONS, is_suppressed, suppressed_urls

router = APIRouter(tags=["opportunities"])


class ScheduleInput(BaseModel):
    professional_profile_id: int
    cadence: Literal["daily", "weekdays", "weekly", "continuous"] = "daily"
    timezone: str = "UTC"
    hour_local: int = Field(default=8, ge=0, le=23)
    max_posting_age_days: int = Field(default=30, ge=1, le=90)
    enabled: bool = True

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("Choose a valid IANA time zone.") from error
        return value


class ScheduleView(BaseModel):
    id: int
    user_id: int
    professional_profile_id: int
    cadence: str
    timezone: str
    run_at_local: time
    enabled: bool
    max_posting_age_days: int
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    running_since: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
    monitoring_status: str = "scheduled"
    email_provider_status: str = "unconfigured"
    monitored_sources: list[dict] = Field(default_factory=list)


class PreferenceView(BaseModel):
    created_at: datetime | None = None
    updated_at: datetime | None = None
    id: int | None = None
    user_id: int
    email_enabled: bool
    push_enabled: bool
    delivery_mode: str
    digest_hour_local: int
    timezone: str
    minimum_match_score: int
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None
    email_provider_status: str = "unconfigured"


class OpportunityUpdate(BaseModel):
    state: str | None = None
    notes: str | None = None


class PreferenceInput(BaseModel):
    email_enabled: bool = True
    push_enabled: bool = False
    delivery_mode: Literal["digest", "immediate"] = "digest"
    digest_hour_local: int = Field(default=8, ge=0, le=23)
    timezone: str = "UTC"
    minimum_match_score: int = Field(default=60, ge=0, le=100)
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        return ScheduleInput.valid_timezone(value)

    @model_validator(mode="after")
    def paired_quiet_hours(self):
        if (self.quiet_hours_start is None) != (self.quiet_hours_end is None):
            raise ValueError("Set both quiet-hour times, or clear both.")
        return self


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


def _schedule_view(row: DiscoverySchedule, session: Session) -> ScheduleView:
    status = "scheduled"
    settings = get_settings()
    profile = session.get(CareerProfile, row.professional_profile_id)
    if not row.enabled or not profile or not profile.is_active:
        status = "paused"
    elif row.cadence == "continuous":
        status = ("worker_disabled" if not settings.monitoring_enabled else
                  "delayed" if row.last_error else
                  "awaiting_baseline" if not row.last_success_at else
                  "delayed" if row.last_success_at < utcnow() - timedelta(minutes=10) else "monitoring")
    sources = []
    if row.cadence == "continuous" and row.enabled and not sources_for(session, row.user_id):
        status = "unconfigured"
    for source in sources_for(session, row.user_id):
        try:
            feed = session.get(PublicBoardFeed, feed_key(source.provider, source.board_key))
        except ValueError:
            feed = None
        sources.append({"provider": source.provider, "company_name": source.company_name,
                        "last_success_at": feed.last_success_at if feed else None,
                        "next_poll_at": feed.next_poll_at if feed else None,
                        "status": "delayed" if feed and feed.last_error else "available" if feed and feed.last_success_at else "not_checked"})
    return ScheduleView(**row.model_dump(), monitoring_status=status, monitored_sources=sources,
                        email_provider_status="configured" if settings.ses_sender_email else "unconfigured")


@router.post("/discovery/schedules", response_model=ScheduleView)
def create_schedule(payload: ScheduleInput, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _owned_profile(payload.professional_profile_id, current.id, session)
    token = work_claims.acquire(session, "monitoring-admission", utcnow(), seconds=10)
    if not token:
        raise HTTPException(409, "Another schedule is being saved. Please retry.")
    try:
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
        changed = row.cadence != payload.cadence or not row.enabled
        row.cadence = payload.cadence
        row.timezone = payload.timezone
        row.run_at_local = datetime.min.replace(hour=payload.hour_local).time()
        row.max_posting_age_days = payload.max_posting_age_days
        row.enabled = payload.enabled
        if row.cadence == "continuous" and row.enabled:
            if not sources_for(session, current.id):
                raise HTTPException(422, "Add a supported company board before enabling monitoring.")
            with session.no_autoflush:
                schedules = [s for s in continuous_schedules(session) if s.id != row.id] + [row]
                try:
                    validate_capacity(session, schedules)
                except ValueError as error:
                    raise HTTPException(422, str(error)) from error
            if changed:
                row.next_run_at = None
                row.monitoring_cycle_at = None
                row.last_success_at = None
                for state in session.exec(select(ScheduleBoardState).where(ScheduleBoardState.schedule_id == row.id)):
                    state.initialized = False
                    state.cycle_at = state.completed_cycle_at = None
                    state.cursor = 0
                    session.add(state)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _schedule_view(row, session)
    except Exception:
        session.rollback()
        raise
    finally:
        work_claims.release(session, "monitoring-admission", token)


@router.get("/discovery/schedules", response_model=list[ScheduleView])
def list_schedules(current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return [_schedule_view(row, session) for row in session.exec(
            select(DiscoverySchedule)
            .where(DiscoverySchedule.user_id == current.id)
            .order_by(DiscoverySchedule.updated_at.desc())
        )]


@router.get("/opportunities", response_model=list[Opportunity])
def list_opportunities(state: str | None = None, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    statement = select(Opportunity, Job, CareerProfile).join(Job, Opportunity.job_id == Job.id).join(CareerProfile, Opportunity.professional_profile_id == CareerProfile.id).where(Opportunity.user_id == current.id, CareerProfile.user_id == current.id)
    if state:
        statement = statement.where(Opportunity.state == state)
    rows = session.exec(statement.order_by(Opportunity.match_score.desc(), Opportunity.last_seen_at.desc())).all()
    # An opportunity can be created by one discovery run and only later
    # flagged dead_link -- suppressing a URL blocks future ingestion (see
    # discovery.py) but does nothing to a row that already exists. Without
    # this, a posting the user has explicitly said is dead keeps sitting in
    # their tracked inbox forever.
    blocked = suppressed_urls(session, current.id, reasons=DISCOVERY_BLOCKING_REASONS)
    return [opportunity for opportunity, job, profile in rows if not is_suppressed(job.url, blocked) and not is_out_of_scope(job, profile)]


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


@router.get("/notification-preferences", response_model=PreferenceView)
def get_preferences(current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """The current preference row, or the model's own defaults if none
    exists yet -- there is no separate "onboard into notifications" step,
    so most accounts have no row at all. jobs/daily_brief.py reads the
    same defaults when a row is absent; this just lets a settings page
    show them without first creating one.
    """
    row = session.exec(select(NotificationPreference).where(NotificationPreference.user_id == current.id)).first()
    row = row or NotificationPreference(user_id=current.id)
    return PreferenceView(**row.model_dump(), email_provider_status="configured" if get_settings().ses_sender_email else "unconfigured")


@router.put("/notification-preferences", response_model=PreferenceView)
def set_preferences(payload: PreferenceInput, current: User = Depends(get_current_user), session: Session = Depends(get_session)):
    row = session.exec(select(NotificationPreference).where(NotificationPreference.user_id == current.id)).first()
    if not row:
        row = NotificationPreference(user_id=current.id)
    for key, value in payload.model_dump().items():
        if key in ("quiet_hours_start", "quiet_hours_end") and key not in payload.model_fields_set:
            continue
        setattr(row, key, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    # A mode/quiet-hour change should take effect on already queued alerts.
    for delivery in session.exec(select(NotificationDelivery).where(
        NotificationDelivery.user_id == current.id, NotificationDelivery.kind.in_(OPPORTUNITY_KINDS),
        NotificationDelivery.status.in_(["queued", "retrying"]),
    )):
        if delivery.attempts == 0:
            delivery.next_attempt_at = None
            session.add(delivery)
    session.commit()
    session.refresh(row)
    return PreferenceView(**row.model_dump(), email_provider_status="configured" if get_settings().ses_sender_email else "unconfigured")
