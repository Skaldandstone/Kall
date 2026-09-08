from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.db import get_session
from kall.models import (
    ConsultingEngagement,
    ConsultingFollowUp,
    ConsultingLead,
    ConsultingProposal,
    Contact,
    User,
)

router = APIRouter(prefix="/me/consulting", tags=["consulting"])

RelationshipSegment = Literal[
    "warm_contact",
    "former_colleague",
    "past_client",
    "referral",
    "community",
    "marketplace",
    "inbound",
    "cold",
]
LeadStage = Literal["identified", "qualified", "proposal", "negotiation", "won", "lost", "paused"]
EngagementStatus = Literal["planned", "active", "paused", "completed", "cancelled"]
DesignPartnerStage = Literal["discovery", "proposed", "active", "completed", "declined"]
WARM_SEGMENTS = {"warm_contact", "former_colleague", "past_client", "referral", "community"}


class ConsultingPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


def _reject_null_updates(payload: BaseModel, fields: tuple[str, ...]) -> None:
    for field in fields:
        if field in payload.model_fields_set and getattr(payload, field) is None:
            raise ValueError(f"{field} cannot be null")


class LeadCreate(ConsultingPayload):
    organization: str = Field(min_length=1, max_length=200)
    opportunity_name: str = Field(min_length=1, max_length=240)
    contact_id: int | None = None
    relationship_segment: RelationshipSegment = "marketplace"
    source: str | None = Field(default=None, max_length=200)
    source_url: str | None = Field(default=None, max_length=2048)
    service_line: str | None = Field(default=None, max_length=200)
    stage: LeadStage = "identified"
    projected_value_cents: int | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    next_step: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=10_000)


class LeadUpdate(ConsultingPayload):
    organization: str | None = Field(default=None, min_length=1, max_length=200)
    opportunity_name: str | None = Field(default=None, min_length=1, max_length=240)
    contact_id: int | None = None
    relationship_segment: RelationshipSegment | None = None
    source: str | None = Field(default=None, max_length=200)
    source_url: str | None = Field(default=None, max_length=2048)
    service_line: str | None = Field(default=None, max_length=200)
    stage: LeadStage | None = None
    projected_value_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    next_step: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=10_000)

    @model_validator(mode="after")
    def keep_required_fields(self):
        _reject_null_updates(self, ("organization", "opportunity_name", "relationship_segment", "stage", "currency"))
        return self


class ProposalCreate(ConsultingPayload):
    lead_id: int
    title: str = Field(min_length=1, max_length=240)
    summary: str | None = Field(default=None, max_length=5_000)
    scope: str | None = Field(default=None, max_length=20_000)
    deliverables: list[str] = Field(default_factory=list, max_length=50)
    fee_cents: int | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")


class ProposalUpdate(ConsultingPayload):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    summary: str | None = Field(default=None, max_length=5_000)
    scope: str | None = Field(default=None, max_length=20_000)
    deliverables: list[str] | None = Field(default=None, max_length=50)
    fee_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

    @model_validator(mode="after")
    def keep_required_fields(self):
        _reject_null_updates(self, ("title", "currency"))
        return self


class FollowUpCreate(ConsultingPayload):
    lead_id: int
    due_on: date
    channel: Literal["email", "phone", "linkedin", "meeting", "other"] = "email"
    purpose: str = Field(min_length=1, max_length=500)
    draft_message: str | None = Field(default=None, max_length=20_000)


class FollowUpUpdate(ConsultingPayload):
    due_on: date | None = None
    channel: Literal["email", "phone", "linkedin", "meeting", "other"] | None = None
    purpose: str | None = Field(default=None, min_length=1, max_length=500)
    draft_message: str | None = Field(default=None, max_length=20_000)

    @model_validator(mode="after")
    def keep_required_fields(self):
        _reject_null_updates(self, ("due_on", "channel", "purpose"))
        return self


class ApprovalRequest(ConsultingPayload):
    confirm_reviewed_for_manual_use: Literal[True]


class FollowUpCompletionRequest(ConsultingPayload):
    confirm_completed_outside_kall: Literal[True]


class EngagementCreate(ConsultingPayload):
    client_name: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=240)
    lead_id: int | None = None
    service_line: str | None = Field(default=None, max_length=200)
    status: EngagementStatus = "planned"
    scope: str | None = Field(default=None, max_length=20_000)
    fee_cents: int | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    starts_on: date | None = None
    ends_on: date | None = None
    design_partner_product: Literal["vaettir"] | None = None
    design_partner_stage: DesignPartnerStage | None = None
    outcome_notes: str | None = Field(default=None, max_length=10_000)

    @model_validator(mode="after")
    def validate_dates_and_partner(self):
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("ends_on cannot be before starts_on")
        if self.design_partner_stage and not self.design_partner_product:
            raise ValueError("design_partner_product is required when design_partner_stage is set")
        return self


class EngagementUpdate(ConsultingPayload):
    client_name: str | None = Field(default=None, min_length=1, max_length=200)
    name: str | None = Field(default=None, min_length=1, max_length=240)
    lead_id: int | None = None
    service_line: str | None = Field(default=None, max_length=200)
    status: EngagementStatus | None = None
    scope: str | None = Field(default=None, max_length=20_000)
    fee_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    starts_on: date | None = None
    ends_on: date | None = None
    design_partner_product: Literal["vaettir"] | None = None
    design_partner_stage: DesignPartnerStage | None = None
    outcome_notes: str | None = Field(default=None, max_length=10_000)

    @model_validator(mode="after")
    def keep_required_fields(self):
        _reject_null_updates(self, ("client_name", "name", "status", "currency"))
        return self


def _owned(session: Session, model, record_id: int, user_id: int, label: str):
    row = session.get(model, record_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(404, f"{label} not found")
    return row


def _owned_contact(session: Session, contact_id: int | None, user_id: int) -> None:
    if contact_id is not None:
        _owned(session, Contact, contact_id, user_id, "Contact")


def _owned_lead(session: Session, lead_id: int | None, user_id: int) -> None:
    if lead_id is not None:
        _owned(session, ConsultingLead, lead_id, user_id, "Consulting lead")


def _save(session: Session, row):
    row.updated_at = utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/workspace")
def consulting_workspace(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    return {
        "leads": list(session.exec(select(ConsultingLead).where(ConsultingLead.user_id == current_user.id).order_by(ConsultingLead.updated_at.desc()))),
        "proposals": list(session.exec(select(ConsultingProposal).where(ConsultingProposal.user_id == current_user.id).order_by(ConsultingProposal.updated_at.desc()))),
        "follow_ups": list(session.exec(select(ConsultingFollowUp).where(ConsultingFollowUp.user_id == current_user.id).order_by(ConsultingFollowUp.due_on, ConsultingFollowUp.id))),
        "engagements": list(session.exec(select(ConsultingEngagement).where(ConsultingEngagement.user_id == current_user.id).order_by(ConsultingEngagement.updated_at.desc()))),
    }


@router.get("/leads", response_model=list[ConsultingLead])
def list_leads(
    relationship_segment: RelationshipSegment | None = None,
    warm_only: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[ConsultingLead]:
    statement = select(ConsultingLead).where(ConsultingLead.user_id == current_user.id)
    if relationship_segment:
        statement = statement.where(ConsultingLead.relationship_segment == relationship_segment)
    if warm_only:
        statement = statement.where(ConsultingLead.relationship_segment.in_(WARM_SEGMENTS))
    return list(session.exec(statement.order_by(ConsultingLead.updated_at.desc())))


@router.post("/leads", response_model=ConsultingLead)
def create_lead(
    payload: LeadCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingLead:
    _owned_contact(session, payload.contact_id, current_user.id)
    return _save(session, ConsultingLead(user_id=current_user.id, **payload.model_dump()))


@router.patch("/leads/{lead_id}", response_model=ConsultingLead)
def update_lead(
    lead_id: int,
    payload: LeadUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingLead:
    row = _owned(session, ConsultingLead, lead_id, current_user.id, "Consulting lead")
    changes = payload.model_dump(exclude_unset=True)
    _owned_contact(session, changes.get("contact_id"), current_user.id)
    for key, value in changes.items():
        setattr(row, key, value)
    return _save(session, row)


@router.post("/proposals", response_model=ConsultingProposal)
def create_proposal(
    payload: ProposalCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingProposal:
    _owned_lead(session, payload.lead_id, current_user.id)
    return _save(session, ConsultingProposal(user_id=current_user.id, **payload.model_dump()))


@router.patch("/proposals/{proposal_id}", response_model=ConsultingProposal)
def update_proposal(
    proposal_id: int,
    payload: ProposalUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingProposal:
    row = _owned(session, ConsultingProposal, proposal_id, current_user.id, "Consulting proposal")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(row, key, value)
    if changes:
        row.status = "draft"
        row.approved_at = None
    return _save(session, row)


@router.post("/proposals/{proposal_id}/approve", response_model=ConsultingProposal)
def approve_proposal(
    proposal_id: int,
    payload: ApprovalRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingProposal:
    del payload
    row = _owned(session, ConsultingProposal, proposal_id, current_user.id, "Consulting proposal")
    if not (row.summary or row.scope) or not row.deliverables:
        raise HTTPException(422, "Add a summary or scope and at least one deliverable before approval")
    row.status = "approved_for_manual_use"
    row.approved_at = utcnow()
    return _save(session, row)


@router.post("/follow-ups", response_model=ConsultingFollowUp)
def create_follow_up(
    payload: FollowUpCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingFollowUp:
    _owned_lead(session, payload.lead_id, current_user.id)
    return _save(session, ConsultingFollowUp(user_id=current_user.id, **payload.model_dump()))


@router.patch("/follow-ups/{follow_up_id}", response_model=ConsultingFollowUp)
def update_follow_up(
    follow_up_id: int,
    payload: FollowUpUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingFollowUp:
    row = _owned(session, ConsultingFollowUp, follow_up_id, current_user.id, "Consulting follow-up")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(row, key, value)
    if changes:
        row.status = "draft"
        row.approved_at = None
        row.completed_at = None
    return _save(session, row)


@router.post("/follow-ups/{follow_up_id}/approve", response_model=ConsultingFollowUp)
def approve_follow_up(
    follow_up_id: int,
    payload: ApprovalRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingFollowUp:
    del payload
    row = _owned(session, ConsultingFollowUp, follow_up_id, current_user.id, "Consulting follow-up")
    if not row.draft_message or not row.draft_message.strip():
        raise HTTPException(422, "Write the follow-up message before approving it")
    row.status = "approved_for_manual_use"
    row.approved_at = utcnow()
    return _save(session, row)


@router.post("/follow-ups/{follow_up_id}/complete", response_model=ConsultingFollowUp)
def complete_follow_up(
    follow_up_id: int,
    payload: FollowUpCompletionRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingFollowUp:
    del payload
    row = _owned(session, ConsultingFollowUp, follow_up_id, current_user.id, "Consulting follow-up")
    if row.status != "approved_for_manual_use":
        raise HTTPException(422, "Approve this follow-up before recording it complete")
    row.status = "completed"
    row.completed_at = utcnow()
    return _save(session, row)


@router.post("/engagements", response_model=ConsultingEngagement)
def create_engagement(
    payload: EngagementCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingEngagement:
    _owned_lead(session, payload.lead_id, current_user.id)
    return _save(session, ConsultingEngagement(user_id=current_user.id, **payload.model_dump()))


@router.patch("/engagements/{engagement_id}", response_model=ConsultingEngagement)
def update_engagement(
    engagement_id: int,
    payload: EngagementUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingEngagement:
    row = _owned(session, ConsultingEngagement, engagement_id, current_user.id, "Consulting engagement")
    changes = payload.model_dump(exclude_unset=True)
    _owned_lead(session, changes.get("lead_id"), current_user.id)
    starts_on = changes.get("starts_on", row.starts_on)
    ends_on = changes.get("ends_on", row.ends_on)
    if starts_on and ends_on and ends_on < starts_on:
        raise HTTPException(422, "ends_on cannot be before starts_on")
    product = changes.get("design_partner_product", row.design_partner_product)
    partner_stage = changes.get("design_partner_stage", row.design_partner_stage)
    if partner_stage and not product:
        raise HTTPException(422, "design_partner_product is required when design_partner_stage is set")
    for key, value in changes.items():
        setattr(row, key, value)
    return _save(session, row)
