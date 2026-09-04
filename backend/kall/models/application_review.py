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
    """Company context, a question bank with per-question guidance, and
    good questions to ask back -- scoped to one application, plus free-text
    notes. ApplicationStatus has no "interview" state of its own (an
    interview can happen any time after submission); Application.
    interview_scheduled_at marks that a person opted into this, but the
    prep itself lives here regardless of stage.

    company_context, question_bank, and questions_to_ask are the model's own
    inference from the job posting -- there is no real company/web research
    behind them (see services/interview_prep.py) -- so the UI must label
    them as an estimate to verify, the same way compensation suggestions
    are labeled elsewhere in this codebase.
    """

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    application_id: int = Field(index=True, foreign_key="application.id", unique=True)
    #: Deprecated in favor of question_bank; kept populated (question text
    #: only) so nothing reading the old shape breaks.
    questions: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    #: {likely_product, likely_tech_stack: list[str], summary}
    company_context: dict = Field(default_factory=dict, sa_column=Column(JSON))
    #: [{question, category, answer_prompt, resources: list[str]}, ...]
    question_bank: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    #: [{stage, question}, ...] -- good questions for the candidate to ask.
    questions_to_ask: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    notes: str = ""


class ApplicationReviewAudit(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(index=True, foreign_key="application.id")
    user_id: int = Field(index=True, foreign_key="user.id")
    event: str
    details: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
