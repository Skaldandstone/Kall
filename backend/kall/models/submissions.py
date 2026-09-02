from datetime import datetime
from typing import Any

from sqlmodel import JSON, Column, Field

from kall.clock import utcnow
from kall.models.core import TimestampMixin


class ConnectorCapability(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    provider: str = Field(index=True, unique=True)
    supports_submission: bool = False
    supports_status: bool = False
    supports_files: bool = True
    requires_authentication: bool = False
    supported_field_types: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    notes: str | None = None


class ApplicationSubmission(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    application_id: int = Field(index=True, foreign_key="application.id", unique=True)
    provider: str
    status: str = "prepared"
    preview_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    preview_checksum: str
    document_checksums: dict[str, str] = Field(default_factory=dict, sa_column=Column(JSON))
    approval_snapshot_at: datetime | None = None
    confirmed_at: datetime | None = None
    submitted_at: datetime | None = None
    manual_url: str | None = None
    failure_code: str | None = None
    failure_detail: str | None = None


class SubmissionAttempt(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    submission_id: int = Field(index=True, foreign_key="applicationsubmission.id")
    idempotency_key: str = Field(index=True, unique=True)
    attempt_number: int = 1
    status: str = "pending"
    request_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    response_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    error_code: str | None = None
    completed_at: datetime | None = None


class SubmissionReceipt(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    submission_id: int = Field(index=True, foreign_key="applicationsubmission.id", unique=True)
    provider_receipt_id: str
    confirmation_number: str | None = None
    submitted_payload_checksum: str
    receipt_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    received_at: datetime = Field(default_factory=utcnow)


class SubmissionAudit(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    submission_id: int = Field(index=True, foreign_key="applicationsubmission.id")
    user_id: int = Field(index=True, foreign_key="user.id")
    event: str
    details: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
