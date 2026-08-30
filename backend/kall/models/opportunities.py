from datetime import datetime, time

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin


class DiscoverySchedule(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    professional_profile_id: int = Field(index=True, foreign_key="careerprofile.id")
    cadence: str = "daily"
    timezone: str = "UTC"
    run_at_local: time = time(8, 0)
    enabled: bool = True
    max_posting_age_days: int = 30
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    running_since: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    monitoring_cycle_at: datetime | None = None


class Opportunity(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    professional_profile_id: int = Field(index=True, foreign_key="careerprofile.id")
    job_id: int = Field(index=True, foreign_key="job.id")
    canonical_key: str = Field(index=True)
    state: str = "new"
    match_score: int = 0
    selected_resume_id: int | None = Field(default=None, foreign_key="resumedocument.id")
    notes: str | None = None
    source_records: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    material_fingerprint: str
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)
    dismissed_fingerprint: str | None = None


class NotificationPreference(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id", unique=True)
    email_enabled: bool = True
    push_enabled: bool = False
    delivery_mode: str = "digest"
    digest_hour_local: int = 8
    timezone: str = "UTC"
    quiet_hours_start: time | None = None
    quiet_hours_end: time | None = None
    minimum_match_score: int = 60


class DeviceRegistration(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    platform: str
    token_hash: str = Field(index=True, unique=True)
    encrypted_token: str
    enabled: bool = True
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)


class NotificationDelivery(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    opportunity_id: int | None = Field(default=None, foreign_key="opportunity.id")
    channel: str
    kind: str
    status: str = "queued"
    dedupe_key: str = Field(index=True)
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
    attempts: int = 0
    last_error: str | None = None
    delivered_at: datetime | None = None
    next_attempt_at: datetime | None = None
    claimed_until: datetime | None = None
    provider_message_id: str | None = None


class GrowthMarketSignal(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    growth_goal_id: int = Field(index=True, foreign_key="careergoal.id")
    observed_jobs: int = 0
    recurring_skills: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    recurring_requirements: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    portfolio_signals: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    generated_at: datetime = Field(default_factory=datetime.utcnow)
