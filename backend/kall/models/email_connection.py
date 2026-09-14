"""A connected mailbox (Gmail or Outlook, read-only) used to auto-detect
application status from confirmation/interview/rejection emails.

Only ever read-only: `scope` records exactly what was granted
(gmail.readonly / Mail.Read), and neither provider adapter
(services/email_oauth.py) ever requests a send/modify scope. Tokens are
encrypted at rest with the same encrypt_sensitive/decrypt_sensitive pair
EEOProfile/WorkAuthorization already use (kall/security.py) -- this is the
first reuse of that pattern for OAuth tokens rather than PII.
"""

from datetime import datetime

from sqlmodel import Field

from kall.models.core import TimestampMixin


class EmailConnection(TimestampMixin, table=True):
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")

    #: "gmail" | "outlook"
    provider: str

    access_token_encrypted: str
    refresh_token_encrypted: str | None = None
    #: What was actually granted, as the provider returned it -- not
    #: necessarily identical across Gmail/Graph, kept verbatim for audit.
    scope: str | None = None
    expires_at: datetime | None = None

    #: Gmail History API historyId, or a Microsoft Graph delta-query token.
    #: Opaque to us either way -- an incremental sync never re-scans the
    #: whole mailbox from a connection that has synced before.
    sync_cursor: str | None = None

    #: "connected" -> "needs_reauth" (refresh failed, person must reconnect)
    #: -> "disconnected" is set on DELETE just before the row itself goes.
    status: str = "connected"
    last_synced_at: datetime | None = None
    last_error: str | None = None
