from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, HttpUrl

from kall.models.enums import WorkType


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str = Field(min_length=10)
    country: str | None = None
    state_region: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    user_id: int
    access_token: str
    token_type: str = "bearer"


class IdentityProfileUpdate(BaseModel):
    preferred_name: str | None = None
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    state_region: str | None = None
    postal_code: str | None = None
    country: str | None = None
    timezone: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_urls: list[str] = Field(default_factory=list)
    website_urls: list[str] = Field(default_factory=list)
    professional_summary: str | None = None


class IdentityProfileResponse(BaseModel):
    email: EmailStr
    support_id: str
    full_name: str
    preferred_name: str | None = None
    phone: str | None = None
    city: str | None = None
    state_region: str | None = None
    country: str | None = None
    timezone: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_urls: list[str] = Field(default_factory=list)
    website_urls: list[str] = Field(default_factory=list)
    professional_summary: str | None = None


class ProfessionalProfileCreate(BaseModel):
    name: str
    target_titles: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    functional_areas: list[str] = Field(default_factory=list)
    include_keywords: list[str] = Field(default_factory=list)
    exclude_keywords: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    states_regions: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    work_types: list[WorkType] = Field(default_factory=lambda: [WorkType.REMOTE])
    employment_types: list[str] = Field(default_factory=lambda: ["full_time"])
    pay_basis: str = "salary"
    minimum_base: int | None = None
    target_base: int | None = None
    stretch_base: int | None = None
    minimum_total_comp: int | None = None
    target_total_comp: int | None = None
    default_resume_id: int | None = None


class JobCreate(BaseModel):
    source: str
    external_id: str | None = None
    company: str
    title: str
    description: str
    url: str
    location: str | None = None
    country: str | None = None
    state_region: str | None = None
    work_type: WorkType | None = None
    industry: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    posted_at: datetime | None = None


class ExternalJobImportRequest(BaseModel):
    url: HttpUrl
    title: str = Field(min_length=1, max_length=300)
    company: str | None = Field(default=None, max_length=200)
    snippet: str | None = Field(default=None, max_length=5000)
    source: str = Field(default="google_cse", max_length=80)


class PrepareApplicationRequest(BaseModel):
    job_id: int
    professional_profile_id: int
    resume_id: int | None = None
    customize_resume: bool = True
    generate_cover_letter: bool = True
    application_mode: str = Field(default="assisted", pattern="^(assisted|automatic)$")


class ApproveApplicationRequest(BaseModel):
    confirmed_sensitive_fields: bool = False
    confirmed_answers: bool = False


class SearchSourceCreate(BaseModel):
    provider: str
    company_name: str
    board_key: str
    enabled: bool = True


class ResumeMetadataUpdate(BaseModel):
    name: str | None = None
    tags: list[str] | None = None
    industries: list[str] | None = None
    target_titles: list[str] | None = None
    is_default: bool | None = None


class LogoutResponse(BaseModel):
    status: str = "logged_out"


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=10)


class EmailVerificationConfirm(BaseModel):
    token: str