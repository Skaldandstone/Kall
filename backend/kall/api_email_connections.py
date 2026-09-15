import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models import EmailConnection, User
from kall.security import encrypt_sensitive
from kall.services.email_filter_export import build_gmail_filter_xml
from kall.services.email_oauth import PROVIDERS, EmailConnectionNotConfigured, redirect_uri_for

router = APIRouter(tags=["email-connections"])

#: How long a person has to complete a provider's consent screen before the
#: signed state this app handed them stops being accepted back.
_STATE_TTL_SECONDS = 600


def _sign_state(user_id: int, provider: str) -> str:
    """A CSRF-binding token for the OAuth round trip -- stateless (HMAC over
    the payload, no server-side row to store or expire), so the callback can
    verify "this authorization was actually initiated by this user for this
    provider, recently" without a database lookup."""
    payload = json.dumps({"user_id": user_id, "provider": provider, "issued_at": time.time()})
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode()
    secret = get_settings().app_secret_key.encode()
    signature = hmac.new(secret, payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"


def _verify_state(state: str, *, user_id: int, provider: str) -> bool:
    try:
        payload_b64, signature = state.split(".", 1)
    except ValueError:
        return False
    secret = get_settings().app_secret_key.encode()
    expected = hmac.new(secret, payload_b64.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return False
    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode()))
    except (ValueError, UnicodeDecodeError):
        return False
    if payload.get("user_id") != user_id or payload.get("provider") != provider:
        return False
    return (time.time() - float(payload.get("issued_at", 0))) <= _STATE_TTL_SECONDS


class ConnectionOut(BaseModel):
    id: int
    provider: str
    status: str
    scope: str | None
    last_synced_at: datetime | None
    last_error: str | None


def _out(connection: EmailConnection) -> ConnectionOut:
    return ConnectionOut(
        id=connection.id, provider=connection.provider, status=connection.status,
        scope=connection.scope, last_synced_at=connection.last_synced_at, last_error=connection.last_error,
    )


def _provider_or_404(provider: str):
    adapter = PROVIDERS.get(provider)
    if not adapter:
        raise HTTPException(404, "Unknown email provider")
    return adapter


@router.get("/me/email-connections", response_model=list[ConnectionOut])
def list_email_connections(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[ConnectionOut]:
    connections = session.exec(select(EmailConnection).where(EmailConnection.user_id == current_user.id)).all()
    return [_out(c) for c in connections]


@router.post("/me/email-connections/{provider}/authorize")
def authorize_email_connection(
    provider: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    adapter = _provider_or_404(provider)
    state = _sign_state(current_user.id, provider)
    try:
        url = adapter.authorize_url(state, redirect_uri_for(provider))
    except EmailConnectionNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"authorize_url": url}


@router.get("/me/email-connections/{provider}/callback")
async def email_connection_callback(
    provider: str,
    code: str,
    state: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    adapter = _provider_or_404(provider)
    if not _verify_state(state, user_id=current_user.id, provider=provider):
        raise HTTPException(400, "Invalid or expired authorization state")
    try:
        token = await adapter.exchange_code(code, redirect_uri_for(provider))
    except EmailConnectionNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc

    existing = session.exec(
        select(EmailConnection).where(EmailConnection.user_id == current_user.id, EmailConnection.provider == provider)
    ).first()
    connection = existing or EmailConnection(user_id=current_user.id, provider=provider, access_token_encrypted="")
    connection.access_token_encrypted = encrypt_sensitive(token.access_token)
    if token.refresh_token:
        connection.refresh_token_encrypted = encrypt_sensitive(token.refresh_token)
    connection.scope = token.scope
    connection.expires_at = utcnow() + timedelta(seconds=token.expires_in) if token.expires_in is not None else None
    connection.status = "connected"
    connection.last_error = None
    session.add(connection)
    session.commit()

    frontend_url = (get_settings().frontend_url or "").rstrip("/")
    return RedirectResponse(url=f"{frontend_url}/settings/email?connected={provider}")


@router.get("/me/email-connections/gmail-filters.xml")
def gmail_filter_import_xml(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    """A downloadable Gmail filter-import file: Settings > Filters and
    Blocked Addresses > Import filters, on the same screen Gmail's own
    Export produces this exact format from. One filter per known ATS
    domain plus every employer domain already in this person's tracked
    applications, all applying a single Kall/Job Search label."""
    xml = build_gmail_filter_xml(session, current_user.id)
    return Response(
        content=xml, media_type="application/xml",
        headers={"Content-Disposition": "attachment; filename=kall-job-search-filters.xml"},
    )


@router.delete("/me/email-connections/{connection_id}")
def disconnect_email_connection(
    connection_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    connection = session.get(EmailConnection, connection_id)
    if not connection or connection.user_id != current_user.id:
        raise HTTPException(404, "Connection not found")
    session.delete(connection)
    session.commit()
    return {"status": "disconnected"}
