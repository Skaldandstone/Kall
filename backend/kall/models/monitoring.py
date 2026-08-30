"""Public feed cache, resumable private observations, and durable alert events."""

from datetime import datetime

from sqlmodel import JSON, Column, Field, SQLModel, UniqueConstraint

from kall.models.core import TimestampMixin


class MonitoringLease(SQLModel, table=True):
    user_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    key: str = Field(primary_key=True)
    token: str | None = None
    expires_at: datetime = Field(default_factory=lambda: datetime.min)


class PublicBoardFeed(TimestampMixin, table=True):
    key: str = Field(primary_key=True)
    provider: str
    board_key: str
    jobs: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    version: str = ""
    etag: str | None = None
    last_modified: str | None = None
    last_checked_at: datetime | None = None
    last_success_at: datetime | None = None
    next_poll_at: datetime | None = None
    failures: int = 0
    last_error: str | None = None
    response_bytes: int = 0


class ScheduleBoardState(TimestampMixin, table=True):
    __table_args__ = (UniqueConstraint("schedule_id", "feed_key", name="uq_schedule_board"),)
    id: int | None = Field(default=None, primary_key=True)
    schedule_id: int = Field(foreign_key="discoveryschedule.id", index=True)
    feed_key: str = Field(foreign_key="publicboardfeed.key")
    initialized: bool = False
    version: str = ""
    criteria_version: str = ""
    cursor: int = 0
    cycle_at: datetime | None = None
    completed_cycle_at: datetime | None = None
    last_success_at: datetime | None = None


class MonitoringObservation(TimestampMixin, table=True):
    __table_args__ = (UniqueConstraint("board_state_id", "job_id", name="uq_monitoring_observation"),)
    id: int | None = Field(default=None, primary_key=True)
    board_state_id: int = Field(foreign_key="scheduleboardstate.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    fingerprint: str
    qualifying: bool = False


class OpportunityNotificationEvent(TimestampMixin, table=True):
    __table_args__ = (UniqueConstraint("user_id", "job_id", "fingerprint", name="uq_opportunity_notification_event"),)
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    fingerprint: str
    status: str = Field(default="pending", index=True)
    delivery_id: int | None = Field(default=None, foreign_key="notificationdelivery.id", index=True)
