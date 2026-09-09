from datetime import date, datetime

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin


class ConsultingPractice(TimestampMixin, table=True):
    """Owner-controlled consulting offer settings, private unless opted in."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id", unique=True)
    available: bool = False
    engagement_types: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    rate_cents: int | None = None
    rate_basis: str = "hour"
    currency: str = "USD"
    availability_note: str | None = None
    agreement_url: str | None = None


class ConsultingLead(TimestampMixin, table=True):
    """A private consulting prospect owned by one Kall account."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    contact_id: int | None = Field(default=None, index=True, foreign_key="contact.id")
    organization: str
    opportunity_name: str
    relationship_segment: str = Field(default="marketplace", index=True)
    source: str | None = None
    source_url: str | None = None
    service_line: str | None = None
    stage: str = Field(default="identified", index=True)
    projected_value_cents: int | None = None
    currency: str = "USD"
    next_step: str | None = None
    notes: str | None = None


class ConsultingProposal(TimestampMixin, table=True):
    """A proposal draft. Kall records approval but never transmits it."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    lead_id: int = Field(index=True, foreign_key="consultinglead.id")
    title: str
    summary: str | None = None
    scope: str | None = None
    deliverables: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    fee_cents: int | None = None
    currency: str = "USD"
    status: str = Field(default="draft", index=True)
    approved_at: datetime | None = None


class ConsultingFollowUp(TimestampMixin, table=True):
    """One reviewable follow-up draft in the account's private queue."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    lead_id: int = Field(index=True, foreign_key="consultinglead.id")
    # API creation still requires a due date. The model default also keeps
    # schema-level maintenance tools able to construct a complete row.
    due_on: date = Field(default_factory=date.today)
    channel: str = "email"
    purpose: str
    draft_message: str | None = None
    status: str = Field(default="draft", index=True)
    approved_at: datetime | None = None
    completed_at: datetime | None = None


class ConsultingEngagement(TimestampMixin, table=True):
    """Delivery and paid design-partner tracking after a lead progresses."""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    lead_id: int | None = Field(default=None, index=True, foreign_key="consultinglead.id")
    client_name: str
    name: str
    service_line: str | None = None
    status: str = Field(default="planned", index=True)
    scope: str | None = None
    fee_cents: int | None = None
    currency: str = "USD"
    starts_on: date | None = None
    ends_on: date | None = None
    design_partner_product: str | None = Field(default=None, index=True)
    design_partner_stage: str | None = None
    outcome_notes: str | None = None
