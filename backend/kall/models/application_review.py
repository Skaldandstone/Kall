from datetime import datetime
from typing import Any

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin


class ScreeningQuestion(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(index=True, foreign_key="application.id")
    key: str = Field(index=True)
    prompt: str
    question_type: str = "text"
    required: bool = True
    options: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    category: str = "general"
    sensitive: bool = False
    source: str = "ats"


class ApplicationAnswer(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(index=True, foreign_key="application.id")
    question_id: int = Field(index=True, foreign_key="screeningquestion.id")
    value: str | None = None
    value_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    source: str = "suggested"
    confidence: float = 0.0
    status: str = "pending"
    evidence: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    reviewed_at: datetime | None = None


class ApplicationReview(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(index=True, foreign_key="application.id", unique=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    status: str = "review_required"
    documents_confirmed: bool = False
    answers_confirmed: bool = False
    sensitive_fields_confirmed: bool = False
    attestations_confirmed: bool = False
    ready_at: datetime | None = None
    approved_at: datetime | None = None
    readiness_issues: list[str] = Field(default_factory=list, sa_column=Column(JSON))


class InterviewPrep(TimestampMixin, table=True):
    """A question bank plus free-text notes to prepare for one application's
    interview. Nothing tracked this before -- ApplicationStatus has no
    "interview" state of its own (an interview can happen any time after
    submission), so this is scoped to a single application rather than a
    pipeline stage. First cut: no mock-interview practice yet, just likely
    questions and a place to jot notes.
    """

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    application_id: int = Field(index=True, foreign_key="application.id", unique=True)
    questions: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    notes: str = ""


class ApplicationReviewAudit(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(index=True, foreign_key="application.id")
    user_id: int = Field(index=True, foreign_key="user.id")
    event: str
    details: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
