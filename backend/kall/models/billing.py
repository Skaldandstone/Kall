from datetime import datetime
from typing import Any

from sqlmodel import JSON, Column, Field, UniqueConstraint

from kall.models.core import TimestampMixin


class Subscription(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id", unique=True)
    provider: str = "stripe"
    provider_customer_id: str | None = Field(default=None, index=True)
    provider_subscription_id: str | None = Field(default=None, index=True)
    status: str = "free"
    plan: str = "free"
    price_id: str | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    #: When the first unresolved payment failure was seen. Set on the first
    #: invoice.payment_failed for a subscription that was not already
    #: failing (so a second retry does not restart the grace window), and
    #: cleared the moment payment recovers. jobs/billing_grace_period.py
    #: downgrades any subscription still failing PAYMENT_GRACE_PERIOD_HOURS
    #: after this timestamp.
    payment_failed_at: datetime | None = None


class ApplicationUsage(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    application_id: int | None = Field(default=None, index=True, foreign_key="application.id")
    event: str
    units: int = 1
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class UsageCounter(TimestampMixin, table=True):
    """How much of one metered thing a user has spent in one period.

    Separate from ApplicationUsage, which is an event log: this is the running
    total the quota check reads, so it stays a single row per period rather
    than a count over history.
    """

    __table_args__ = (
        UniqueConstraint("user_id", "meter", "period", name="uq_usagecounter_user_meter_period"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    #: applications | ai_actions
    meter: str = Field(index=True)
    #: "lifetime", or "YYYY-MM" for a monthly allowance.
    period: str = Field(index=True)
    used: int = 0


class BillingEvent(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    provider: str = "stripe"
    provider_event_id: str = Field(index=True, unique=True)
    event_type: str
    payload_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    processed_at: datetime | None = None
    status: str = "pending"
    error: str | None = None
