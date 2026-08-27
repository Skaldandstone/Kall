from datetime import date, datetime
from typing import Any

from sqlmodel import JSON, Column, Field, SQLModel

from kall.models.enums import ApplicationStatus, PrivacyScope, SubscriptionPlan, WorkType


class TimestampMixin(SQLModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class User(TimestampMixin, table=True):
    # The integer id stays the identity across ~60 foreign keys; Clerk's user id
    # is carried alongside it rather than replacing it, so identity lives in
    # Clerk while all application data keeps keying off this row.
    id: int | None = Field(default=None, primary_key=True)
    clerk_user_id: str | None = Field(default=None, index=True, unique=True)
    email: str = Field(index=True, unique=True)
    full_name: str
    country: str | None = None
    state_region: str | None = None
    plan: SubscriptionPlan = Field(default=SubscriptionPlan.FREE)
    completed_application_count: int = 0
    #: Exempt from every plan limit. For development and support accounts, and
    #: set by an administrator rather than by anything the user can reach --
    #: there is no self-serve path to this flag.
    billing_exempt: bool = False
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    is_active: bool = True


class FieldPrivacy(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    field_path: str = Field(index=True)
    scopes: list[str] = Field(default_factory=lambda: [PrivacyScope.PRIVATE], sa_column=Column(JSON))
    require_confirmation: bool = True


class CandidateProfile(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id", unique=True)
    preferred_name: str | None = None
    phone_encrypted: str | None = None
    address_encrypted: str | None = None
    city: str | None = None
    state_region: str | None = None
    postal_code_encrypted: str | None = None
    country: str | None = None
    timezone: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_urls: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    website_urls: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    professional_summary: str | None = None


class CareerProfile(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str
    target_titles: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    industries: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    functional_areas: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    include_keywords: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    exclude_keywords: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    countries: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    states_regions: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    work_types: list[str] = Field(default_factory=lambda: [WorkType.REMOTE], sa_column=Column(JSON))
    employment_types: list[str] = Field(default_factory=lambda: ["full_time"], sa_column=Column(JSON))
    minimum_base: int | None = None
    target_base: int | None = None
    stretch_base: int | None = None
    minimum_total_comp: int | None = None
    target_total_comp: int | None = None
    target_bonus_percent: float | None = None
    equity_preference: str | None = None
    travel_max_percent: int | None = None
    relocation_preference: str | None = None
    default_resume_id: int | None = None
    is_active: bool = True


class ResumeDocument(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str
    file_path: str
    mime_type: str
    #: Bytes on disk. DocumentArtifact has always tracked this; resumes did
    #: not, which left half the stored data unmeasurable.
    byte_size: int = 0
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    industries: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    target_titles: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    extracted_text: str | None = None
    is_default: bool = False
    version: int = 1


class Job(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    source: str
    external_id: str | None = Field(default=None, index=True)
    company: str = Field(index=True)
    title: str = Field(index=True)
    description: str
    url: str = Field(unique=True, index=True)
    location: str | None = None
    country: str | None = None
    state_region: str | None = None
    work_type: WorkType | None = None
    industry: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    currency: str = "USD"
    posted_at: datetime | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class JobMatch(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    career_profile_id: int = Field(index=True, foreign_key="careerprofile.id")
    job_id: int = Field(index=True, foreign_key="job.id")
    score: int
    strengths: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    gaps: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    recommendation: str
    selected_resume_id: int | None = None


class Application(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    job_id: int = Field(index=True, foreign_key="job.id")
    career_profile_id: int = Field(index=True, foreign_key="careerprofile.id")
    base_resume_id: int | None = Field(default=None, foreign_key="resumedocument.id")
    customized_resume_path: str | None = None
    cover_letter_path: str | None = None
    status: ApplicationStatus = Field(default=ApplicationStatus.PREPARING)
    ats_provider: str | None = None
    prepared_payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    unanswered_questions: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    sensitive_fields_present: bool = False
    user_approved_at: datetime | None = None
    submitted_at: datetime | None = None
    failure_reason: str | None = None


class Reference(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str
    organization: str | None = None
    title: str | None = None
    relationship_description: str
    email_encrypted: str | None = None
    phone_encrypted: str | None = None
    linkedin_url: str | None = None
    permission_to_contact: bool = False
    availability: str = "unknown"
    last_confirmed_on: date | None = None
    notes_encrypted: str | None = None


class AdminAction(TimestampMixin, table=True):
    """An append-only record of every administrative change to an account.

    Support tools act on other people's data, so a change nobody wrote down is
    indistinguishable from a bug or an abuse. Nothing in the API edits or
    deletes these rows.

    actor_email is stored alongside the id on purpose: it is the answer to
    "who did this" months later, and it must survive the actor's own account
    being renamed or removed.
    """

    id: int | None = Field(default=None, primary_key=True)
    actor_user_id: int = Field(index=True, foreign_key="user.id")
    actor_email: str
    action: str = Field(index=True)
    target_user_id: int = Field(index=True, foreign_key="user.id")
    detail: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    occurred_at: datetime = Field(default_factory=datetime.utcnow, index=True)
