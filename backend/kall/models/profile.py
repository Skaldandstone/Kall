from datetime import date

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin
from kall.models.enums import Proficiency


class Education(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    institution: str
    degree: str | None = None
    major: str | None = None
    minor: str | None = None
    graduation_date: date | None = None
    gpa: float | None = None
    honors: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    country: str | None = None
    state_region: str | None = None


class Employment(TimestampMixin, table=True):
    """Structured work history.

    Employer, title, and dates previously existed only as free text inside
    ResumeDocument.extracted_text -- Achievement carries employer/role_title
    but has no dates and no ordering, so "most recent employer" could not be
    derived from it. Nearly every job application form requires these fields,
    so autofill needs them structured.
    """

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    employer: str
    job_title: str
    location: str | None = None
    start_date: date | None = None
    # None means "present" only when is_current is set; an ended role with an
    # unknown end date is possible, so the two are tracked independently.
    end_date: date | None = None
    is_current: bool = False
    description: str | None = None


class Skill(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str = Field(index=True)
    category: str | None = None
    proficiency: str | None = None
    years_experience: float | None = None
    last_used_year: int | None = None
    is_primary: bool = False
    verified: bool = False


class Certification(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str
    issuing_organization: str
    credential_id_encrypted: str | None = None
    verification_url: str | None = None
    obtained_on: date | None = None
    expires_on: date | None = None
    renewal_required: bool = False
    reminder_days_before: int = 90
    status: str = "active"


class SecurityClearance(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    country: str
    clearance_type: str
    status: str
    granted_on: date | None = None
    expires_on: date | None = None
    agency_encrypted: str | None = None
    sponsor_encrypted: str | None = None
    polygraph_type: str | None = None


class Language(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str
    speaking: Proficiency
    reading: Proficiency
    writing: Proficiency
    years_used: float | None = None
    last_used_year: int | None = None
    certification_name: str | None = None
    certification_obtained_on: date | None = None
    certification_expires_on: date | None = None


class AwardHonor(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str
    issuing_organization: str
    received_on: date | None = None
    description: str | None = None
    evidence_url: str | None = None


class Publication(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    kind: str
    title: str
    organization_or_venue: str | None = None
    published_on: date | None = None
    url: str | None = None
    description: str | None = None
    co_authors: list[str] = Field(default_factory=list, sa_column=Column(JSON))


class Patent(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    title: str
    patent_number: str | None = None
    jurisdiction: str | None = None
    status: str | None = None
    filed_on: date | None = None
    granted_on: date | None = None
    url: str | None = None


class SpeakingEngagement(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    title: str
    event: str
    engagement_type: str
    occurred_on: date | None = None
    url: str | None = None
    description: str | None = None


class ProfessionalMembership(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    organization: str
    membership_type: str | None = None
    member_since: date | None = None
    expires_on: date | None = None
    leadership_roles: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    status: str = "active"


class VolunteerBoardService(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    organization: str
    role: str
    service_type: str
    started_on: date | None = None
    ended_on: date | None = None
    description: str | None = None
    impact_metrics: list[str] = Field(default_factory=list, sa_column=Column(JSON))
