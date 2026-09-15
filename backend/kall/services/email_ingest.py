"""Fetch new mail from a connected mailbox, classify it, and propose
application-status updates -- never write one directly (see
api_email_events.py's confirm flow, Phase 3, for the only code path
allowed to mutate Application.status from this).

**Simplification, disclosed rather than hidden**: `sync_cursor` was designed
for Gmail's History API / Graph delta-query tokens (true incremental sync
that never re-scans a mailbox). This first version instead stores the ISO
timestamp of the newest message processed and re-queries "since that
time" on each tick -- correct and simple, but re-fetches (not
re-classifies -- external_message_id still dedupes that) a small
overlapping window every sync rather than using a real cursor. Upgrading
to the History/delta APIs is a follow-up once there's a real connected
mailbox to develop it against.

Every code path here is designed to be exercised without a live Gmail/
Outlook account: MailboxClient implementations take an injectable
httpx.AsyncClient (same convention as job_search_aggregation.py), and the
classifier/matcher/lease-orchestration logic underneath is pure and fully
covered without any network access at all.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

import httpx
from kall.clock import utcnow
from kall.models import Application, EmailConnection, EmailDetectedEvent, Job
from kall.security import decrypt_sensitive
from kall.services import work_claims
from kall.services.applications import application_stage, find_existing_application
from kall.services.ats_web_search import ATS_DOMAINS
from kall.services.openai_json import ask_for_json
from sqlmodel import Session, select

#: Sender domains that pre-qualify a message for classification without
#: relying on keyword text alone -- every structured ATS this app already
#: knows how to search, plus a generic no-reply pattern most employers use.
_ATS_SENDER_DOMAINS = {domain for _name, domain in ATS_DOMAINS}

_KEYWORD_PATTERNS = {
    "confirmation": re.compile(r"application (received|submitted)|thank you for applying|we('| ha)ve received your application", re.IGNORECASE),
    "interview": re.compile(r"schedule.*interview|interview.*(invit|request)|would like to (speak|talk|meet) with you", re.IGNORECASE),
    "rejection": re.compile(r"regret to inform|not (moving forward|selected|be moving forward)|decided to (move forward|proceed) with other candidates|position has been filled", re.IGNORECASE),
}

_URL_PATTERN = re.compile(r"https?://[^\s<>\"]+")

_CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "is_job_related": {"type": "boolean"},
        "event_type": {"type": "string", "enum": ["confirmation", "interview", "rejection", "other"]},
        "confidence": {"type": "number"},
        "company_name_guess": {"type": "string"},
    },
    "required": ["is_job_related", "event_type", "confidence", "company_name_guess"],
    "additionalProperties": False,
}


@dataclass
class RawEmailMessage:
    external_id: str
    sender: str
    subject: str
    snippet: str
    body: str
    received_at: datetime


class MailboxClient(Protocol):
    async def fetch_new_messages(self, connection: EmailConnection, *, since: datetime | None) -> list[RawEmailMessage]: ...


def _sender_domain(sender: str) -> str:
    match = re.search(r"@([\w.-]+)", sender)
    return match.group(1).lower() if match else ""


def passes_local_prefilter(message: RawEmailMessage) -> bool:
    """The cheap check every message goes through before anything is ever
    sent to a model -- a sender on a known ATS domain, or subject/snippet
    text matching one of the same phrases the rules-based fallback
    classifier below looks for. Most inbox mail never gets past this."""
    if _sender_domain(message.sender) in _ATS_SENDER_DOMAINS:
        return True
    text = f"{message.subject} {message.snippet}"
    return any(pattern.search(text) for pattern in _KEYWORD_PATTERNS.values())


def _rules_classify(message: RawEmailMessage) -> dict:
    text = f"{message.subject} {message.snippet}"
    for event_type, pattern in _KEYWORD_PATTERNS.items():
        if pattern.search(text):
            return {"is_job_related": True, "event_type": event_type, "confidence": 0.5, "company_name_guess": _sender_domain(message.sender)}
    return {"is_job_related": False, "event_type": "other", "confidence": 0.0, "company_name_guess": ""}


def classify_message(message: RawEmailMessage) -> dict:
    """Model-then-rules, the same shape role_gaps.py's suggest_role_gaps
    uses: a schema-constrained model call when a key is configured, the
    deterministic keyword fallback otherwise -- "silence is not an option"
    per openai_json.py's own documented contract."""
    prompt = (
        "An email arrived in someone's job-search-labeled inbox folder. Classify it.\n\n"
        f"From: {message.sender}\nSubject: {message.subject}\nBody excerpt: {message.snippet[:1000]}"
    )
    result = ask_for_json(
        prompt, schema_name="email_classification", schema=_CLASSIFY_SCHEMA, purpose="email classification",
        source_ref=f"email:{message.external_id}",
    )
    if result is None:
        return _rules_classify(message)
    return {**result, "_source": "model"}


def extract_url(body: str) -> str | None:
    match = _URL_PATTERN.search(body)
    return match.group(0) if match else None


def match_application(session: Session, user_id: int, *, url: str | None, company_guess: str) -> Application | None:
    """Two-tier, cheapest first: a URL in the email body is a
    high-confidence, zero-guesswork match via the same match_keys()
    every other dedupe-by-link path in this codebase already uses; failing
    that, fuzzy-match the classifier's company guess (or sender domain)
    against Job.company across this person's *open* applications only --
    a closed one is not what a new email is about."""
    if url:
        found = find_existing_application(session, user_id, url=url)
        if found:
            return found
    if not company_guess:
        return None
    rows = session.exec(select(Application, Job).join(Job, Job.id == Application.job_id).where(Application.user_id == user_id)).all()
    guess = company_guess.casefold()
    for application, job in rows:
        if application_stage(application) in {"rejected", "closed"}:
            continue
        company = (job.company or "").casefold()
        if guess and (guess in company or company in guess):
            return application
    return None


async def ingest_connection(session: Session, connection: EmailConnection, client: MailboxClient) -> list[EmailDetectedEvent]:
    """One call per due EmailConnection, leased so two ticks never process
    the same mailbox concurrently (work_claims.py, the same lease
    discovery/monitoring already use)."""
    lease_key = f"email_connection:{connection.id}"
    token = work_claims.acquire(session, lease_key, utcnow())
    if token is None:
        return []
    try:
        since = None
        if connection.sync_cursor:
            try:
                since = datetime.fromisoformat(connection.sync_cursor)
            except ValueError:
                since = None
        messages = await client.fetch_new_messages(connection, since=since)

        created: list[EmailDetectedEvent] = []
        newest_seen = since
        for message in messages:
            newest_seen = message.received_at if newest_seen is None else max(newest_seen, message.received_at)
            if not passes_local_prefilter(message):
                continue
            already = session.exec(
                select(EmailDetectedEvent).where(EmailDetectedEvent.external_message_id == message.external_id)
            ).first()
            if already:
                continue
            classification = classify_message(message)
            if not classification.get("is_job_related"):
                continue
            url = extract_url(message.body)
            application = match_application(session, connection.user_id, url=url, company_guess=classification.get("company_name_guess", ""))
            event = EmailDetectedEvent(
                connection_id=connection.id,
                user_id=connection.user_id,
                application_id=application.id if application else None,
                external_message_id=message.external_id,
                event_type=classification["event_type"],
                confidence=float(classification.get("confidence", 0.0)),
                source=classification.get("_source", "rules"),
                evidence={"sender": message.sender, "subject": message.subject, "snippet": message.snippet[:280]},
            )
            session.add(event)
            created.append(event)

        connection.last_synced_at = utcnow()
        connection.last_error = None
        if newest_seen is not None:
            connection.sync_cursor = newest_seen.isoformat()
        session.add(connection)
        session.commit()
        for event in created:
            session.refresh(event)
        return created
    finally:
        work_claims.release(session, lease_key, token)


class GmailMailboxClient:
    """A simple time-window sync against Gmail's REST API -- see this
    module's docstring for why this is not yet the History API."""

    async def fetch_new_messages(self, connection: EmailConnection, *, since: datetime | None) -> list[RawEmailMessage]:
        access_token = decrypt_sensitive(connection.access_token_encrypted)
        if not access_token:
            return []
        query = "label:kall-job-search" if since is None else f"label:kall-job-search after:{int(since.timestamp())}"
        async with httpx.AsyncClient(timeout=15, headers={"Authorization": f"Bearer {access_token}"}) as http_client:
            listing = await http_client.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                params={"q": query, "maxResults": 25},
            )
            listing.raise_for_status()
            ids = [item["id"] for item in listing.json().get("messages", [])]
            messages: list[RawEmailMessage] = []
            for message_id in ids:
                detail = await http_client.get(f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}")
                if detail.status_code != 200:
                    continue
                data = detail.json()
                headers = {h["name"].lower(): h["value"] for h in data.get("payload", {}).get("headers", [])}
                messages.append(RawEmailMessage(
                    external_id=message_id,
                    sender=headers.get("from", ""),
                    subject=headers.get("subject", ""),
                    snippet=data.get("snippet", ""),
                    body=data.get("snippet", ""),
                    received_at=datetime.fromtimestamp(int(data.get("internalDate", 0)) / 1000) if data.get("internalDate") else utcnow(),
                ))
            return messages


class OutlookMailboxClient:
    async def fetch_new_messages(self, connection: EmailConnection, *, since: datetime | None) -> list[RawEmailMessage]:
        access_token = decrypt_sensitive(connection.access_token_encrypted)
        if not access_token:
            return []
        cutoff = since or (utcnow() - timedelta(days=1))
        async with httpx.AsyncClient(timeout=15, headers={"Authorization": f"Bearer {access_token}"}) as http_client:
            response = await http_client.get(
                "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
                params={
                    "$filter": f"receivedDateTime ge {cutoff.isoformat()}Z and categories/any(c:c eq 'Kall Job Search')",
                    "$select": "id,from,subject,bodyPreview,receivedDateTime",
                    "$top": 25,
                },
            )
            response.raise_for_status()
            messages = []
            for item in response.json().get("value", []):
                sender = ((item.get("from") or {}).get("emailAddress") or {}).get("address", "")
                messages.append(RawEmailMessage(
                    external_id=item["id"],
                    sender=sender,
                    subject=item.get("subject", ""),
                    snippet=item.get("bodyPreview", ""),
                    body=item.get("bodyPreview", ""),
                    received_at=datetime.fromisoformat(item["receivedDateTime"].replace("Z", "+00:00")).replace(tzinfo=None) if item.get("receivedDateTime") else utcnow(),
                ))
            return messages


MAILBOX_CLIENTS: dict[str, MailboxClient] = {
    "gmail": GmailMailboxClient(),
    "outlook": OutlookMailboxClient(),
}
