from datetime import date
from typing import Literal
from urllib.parse import quote_plus, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.db import get_session
from kall.services.job_search_aggregation import aggregate_job_search
from kall.models import (
    CareerPage,
    CareerProfile,
    ConsultingEngagement,
    ConsultingFollowUp,
    ConsultingLead,
    ConsultingPractice,
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


class PracticeUpdate(ConsultingPayload):
    available: bool = False
    engagement_types: list[Literal["consulting", "fractional", "advisory", "project"]] = Field(default_factory=list)
    rate_cents: int | None = Field(default=None, ge=0)
    rate_basis: Literal["hour", "day", "project", "month"] = "hour"
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    availability_note: str | None = Field(default=None, max_length=500)
    agreement_url: str | None = Field(default=None, max_length=2048)

    @field_validator("agreement_url")
    @classmethod
    def require_safe_agreement_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Agreement links must use a complete HTTPS address")
        return value


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


def _owned_profile(session: Session, profile_id: int, user_id: int) -> CareerProfile:
    return _owned(session, CareerProfile, profile_id, user_id, "Professional profile")


def _consulting_searches(profile: CareerProfile, focus: str) -> list[dict[str, str]]:
    titles = [value.strip() for value in profile.target_titles if value.strip()][:3]
    functions = [value.strip() for value in profile.functional_areas if value.strip()][:3]
    industries = [value.strip() for value in profile.industries if value.strip()][:2]
    specialty = focus.strip() or " OR ".join(functions or titles) or "business transformation"
    market = " OR ".join(industries)
    context = f" ({market})" if market else ""
    searches = [
        (
            "Catalant",
            "catalant.com",
            f"({specialty}) (consultant OR advisory OR assessment){context}",
            "Look for scoped projects where an experienced independent specialist can solve a named business problem.",
        ),
        (
            "Business Talent Group",
            "businesstalentgroup.com",
            f"({specialty}) (interim OR consultant OR transformation){context}",
            "Look for interim leadership and project work with a clear executive owner.",
        ),
        (
            "Contra",
            "contra.com",
            f"({specialty}) (freelance OR consultant OR project){context}",
            "Look for portfolio-led independent work with a specific buyer and deliverable.",
        ),
        (
            "Open web",
            "",
            f'"seeking consultant" ({specialty}){context}',
            "Find public demand signals outside a single marketplace, then verify the organization and scope.",
        ),
    ]
    return [
        {
            "provider": provider,
            "domain": domain,
            "query": f"site:{domain} {query}" if domain else query,
            "search_url": f"https://www.google.com/search?q={quote_plus(f'site:{domain} {query}' if domain else query)}",
            "rationale": rationale,
            "suggested_segment": "marketplace" if domain else "inbound",
        }
        for provider, domain, query, rationale in searches
    ]


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
    practice = session.exec(select(ConsultingPractice).where(ConsultingPractice.user_id == current_user.id)).first()
    page = session.exec(select(CareerPage).where(CareerPage.user_id == current_user.id)).first()
    return {
        "practice": practice,
        "career_page": {"exists": page is not None, "published": bool(page and page.published), "slug": page.slug if page else None},
        "leads": list(session.exec(select(ConsultingLead).where(ConsultingLead.user_id == current_user.id).order_by(ConsultingLead.updated_at.desc()))),
        "proposals": list(session.exec(select(ConsultingProposal).where(ConsultingProposal.user_id == current_user.id).order_by(ConsultingProposal.updated_at.desc()))),
        "follow_ups": list(session.exec(select(ConsultingFollowUp).where(ConsultingFollowUp.user_id == current_user.id).order_by(ConsultingFollowUp.due_on, ConsultingFollowUp.id))),
        "engagements": list(session.exec(select(ConsultingEngagement).where(ConsultingEngagement.user_id == current_user.id).order_by(ConsultingEngagement.updated_at.desc()))),
    }


@router.put("/practice", response_model=ConsultingPractice)
def update_consulting_practice(
    payload: PracticeUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ConsultingPractice:
    row = session.exec(select(ConsultingPractice).where(ConsultingPractice.user_id == current_user.id)).first()
    row = row or ConsultingPractice(user_id=current_user.id)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    return _save(session, row)


@router.get("/discovery-plan/{profile_id}")
async def consulting_discovery_plan(
    profile_id: int,
    focus: str = Query(default="", max_length=120),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """Turn a career profile into reviewable consulting-search actions.

    This finds public search paths and prompts from contacts the user already
    recorded, and runs those searches server-side so the answer is a list of
    actual engagements rather than four links to Google. It never searches
    private networks or sends outreach.
    """
    profile = _owned_profile(session, profile_id, current_user.id)
    searches = _consulting_searches(profile, focus)
    # aggregate_job_search tags each hit with the query's provider/domain;
    # the open-web query has no domain, which it tolerates as "".
    aggregated = await aggregate_job_search([
        {"provider": item["provider"], "domain": item["domain"], "query": item["query"]} for item in searches
    ])
    segment_by_provider = {item["provider"]: item["suggested_segment"] for item in searches}
    contacts = list(
        session.exec(
            select(Contact)
            .where(Contact.user_id == current_user.id)
            .order_by(Contact.last_contacted_on.desc(), Contact.updated_at.desc())
            .limit(5)
        )
    )
    specialty = focus.strip() or ", ".join(profile.functional_areas[:2] or profile.target_titles[:2])
    if not specialty:
        specialty = "your strongest business outcome"
    return {
        "professional_profile_id": profile.id,
        "profile_name": profile.name,
        "positioning": f"Lead with {specialty}. Look for a specific business problem, a decision maker, and an outcome you can prove.",
        "qualification_questions": [
            "What expensive or urgent problem is this organization trying to solve?",
            "Who owns the outcome and can approve outside help?",
            "What measurable result could you deliver in the first 30 days?",
            "Which achievement in your profile proves you can do this work?",
            "Is there a real timeline and budget, or only general interest?",
        ],
        "searches": searches,
        "search_enabled": aggregated["enabled"],
        "results": [
            {
                "title": result["title"],
                "url": result["url"],
                "snippet": result["snippet"],
                "provider": result["provider"],
                "suggested_segment": segment_by_provider.get(result["provider"], "inbound"),
            }
            for result in aggregated["results"]
        ],
        "warm_lead_prompts": [
            {
                "contact_id": contact.id,
                "name": contact.name,
                "company": contact.company,
                "title": contact.title,
                "relationship": contact.relationship,
                "assistant_prompt": f"Ask whether {contact.name} knows a team facing a {specialty} problem. Draft and review the message before sending it outside Kall.",
            }
            for contact in contacts
        ],
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
