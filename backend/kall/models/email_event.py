"""A detected application-status signal from a connected mailbox.

Shaped like TailoringChange (models/tailoring.py): propose, then a person
confirms or dismisses it -- nothing here ever mutates an Application's
status on its own. `application_id` is nullable because an unmatched
confirmation email is still worth surfacing: it is very likely an
application made outside Kall entirely (see api_email_events.py's confirm
flow, Phase 3).

Full email bodies are never persisted -- `evidence` only ever holds what a
person needs to recognize and confirm the match (sender, subject, a short
matched snippet).
"""

from datetime import datetime
from typing import Any

from sqlmodel import JSON, Column, Field

from kall.models.core import TimestampMixin


class EmailDetectedEvent(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    connection_id: int = Field(index=True, foreign_key="emailconnection.id")
    #: Denormalized so ownership can be checked without a join, same
    #: reasoning as CareerPageSection.user_id.
    user_id: int = Field(index=True, foreign_key="user.id")
    application_id: int | None = Field(default=None, foreign_key="application.id")

    #: The provider's own message id -- not the message itself -- so a
    #: message already processed is never turned into a second event on the
    #: next sync tick.
    external_message_id: str = Field(index=True)

    #: "confirmation" | "interview" | "rejection" | "other"
    event_type: str
    confidence: float
    #: "model" | "rules"
    source: str
    #: {sender, subject, snippet} -- never the full body.
    evidence: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    #: "pending" -> "confirmed" | "dismissed"
    status: str = "pending"
    reviewed_at: datetime | None = None
