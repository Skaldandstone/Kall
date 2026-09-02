from datetime import datetime

from sqlmodel import Field

from kall.clock import utcnow
from kall.models.core import TimestampMixin


class TestimonialRequest(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    recipient_name: str
    recipient_email_encrypted: str
    relationship: str
    request_type: str = "testimonial"
    personal_message: str | None = None
    token_hash: str = Field(index=True, unique=True)
    status: str = "pending"
    expires_at: datetime | None = None
    sent_at: datetime | None = None
    completed_at: datetime | None = None
    revoked_at: datetime | None = None


class Testimonial(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    request_id: int | None = Field(default=None, foreign_key="testimonialrequest.id")
    author_name: str
    author_title: str | None = None
    author_company: str | None = None
    relationship: str
    body: str
    status: str = "pending_review"
    verified_via_request: bool = False
    include_on_profile: bool = False
    include_in_applications: bool = False
    permission_granted: bool = False
    approved_at: datetime | None = None
    withdrawn_at: datetime | None = None
    withdrawal_reason: str | None = None


class ApplicationTestimonial(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(index=True, foreign_key="application.id")
    testimonial_id: int = Field(index=True, foreign_key="testimonial.id")
    user_id: int = Field(index=True, foreign_key="user.id")
    included_at: datetime = Field(default_factory=utcnow)
