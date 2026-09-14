"""OAuth for connecting a read-only mailbox (Gmail or Outlook).

Narrowest possible scope from each provider's own consent screen --
gmail.readonly, Mail.Read -- never send/modify/settings. James registers the
actual OAuth client credentials himself in each provider's console; this
module is the adapter code that uses whatever `config.py` settings end up
holding (see EmailConnectionNotConfigured below for the "not registered
yet" path, matching every other optional integration in this codebase).
"""

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode

import httpx
from kall.config import get_settings

GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GRAPH_MAIL_READ_SCOPE = "https://graph.microsoft.com/Mail.Read offline_access"

_GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_MICROSOFT_AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
_MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"


class EmailConnectionNotConfigured(Exception):
    """Raised when a provider's OAuth client id/secret isn't set yet --
    surfaced to the API as "this connection isn't available," the same
    shape stripe_billing.py and the RevenueCat services already use for an
    integration whose credentials haven't been registered."""


@dataclass
class TokenResult:
    access_token: str
    refresh_token: str | None
    expires_in: int | None
    scope: str | None


class EmailOAuthProvider(Protocol):
    name: str

    def authorize_url(self, state: str, redirect_uri: str) -> str: ...
    async def exchange_code(self, code: str, redirect_uri: str, *, client: httpx.AsyncClient | None = None) -> TokenResult: ...
    async def refresh(self, refresh_token: str, *, client: httpx.AsyncClient | None = None) -> TokenResult: ...


def _token_result(payload: dict) -> TokenResult:
    return TokenResult(
        access_token=payload["access_token"],
        refresh_token=payload.get("refresh_token"),
        expires_in=payload.get("expires_in"),
        scope=payload.get("scope"),
    )


async def _post_form(url: str, data: dict, *, client: httpx.AsyncClient | None) -> dict:
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=15)
    try:
        response = await http_client.post(url, data=data, headers={"Accept": "application/json"})
        response.raise_for_status()
        return response.json()
    finally:
        if owns_client:
            await http_client.aclose()


class GmailOAuthProvider:
    name = "gmail"

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        settings = get_settings()
        if not settings.google_oauth_client_id:
            raise EmailConnectionNotConfigured("Google OAuth client is not configured")
        params = {
            "client_id": settings.google_oauth_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": GMAIL_READONLY_SCOPE,
            "access_type": "offline",
            # Forces a refresh_token even on a person's second connect --
            # without this, Google only issues one on the very first
            # consent for that account, silently starving every later
            # reconnect of the token this feature needs to sync unattended.
            "prompt": "consent",
            "state": state,
        }
        return f"{_GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str, *, client: httpx.AsyncClient | None = None) -> TokenResult:
        settings = get_settings()
        if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
            raise EmailConnectionNotConfigured("Google OAuth client is not configured")
        payload = await _post_form(_GOOGLE_TOKEN_URL, {
            "code": code,
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }, client=client)
        return _token_result(payload)

    async def refresh(self, refresh_token: str, *, client: httpx.AsyncClient | None = None) -> TokenResult:
        settings = get_settings()
        if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
            raise EmailConnectionNotConfigured("Google OAuth client is not configured")
        payload = await _post_form(_GOOGLE_TOKEN_URL, {
            "refresh_token": refresh_token,
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "grant_type": "refresh_token",
        }, client=client)
        # Google does not resend refresh_token on a refresh call -- the
        # caller must keep the one it already has.
        payload.setdefault("refresh_token", refresh_token)
        return _token_result(payload)


class OutlookOAuthProvider:
    name = "outlook"

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        settings = get_settings()
        if not settings.microsoft_oauth_client_id:
            raise EmailConnectionNotConfigured("Microsoft OAuth client is not configured")
        params = {
            "client_id": settings.microsoft_oauth_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": GRAPH_MAIL_READ_SCOPE,
            "state": state,
        }
        return f"{_MICROSOFT_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str, *, client: httpx.AsyncClient | None = None) -> TokenResult:
        settings = get_settings()
        if not settings.microsoft_oauth_client_id or not settings.microsoft_oauth_client_secret:
            raise EmailConnectionNotConfigured("Microsoft OAuth client is not configured")
        payload = await _post_form(_MICROSOFT_TOKEN_URL, {
            "code": code,
            "client_id": settings.microsoft_oauth_client_id,
            "client_secret": settings.microsoft_oauth_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "scope": GRAPH_MAIL_READ_SCOPE,
        }, client=client)
        return _token_result(payload)

    async def refresh(self, refresh_token: str, *, client: httpx.AsyncClient | None = None) -> TokenResult:
        settings = get_settings()
        if not settings.microsoft_oauth_client_id or not settings.microsoft_oauth_client_secret:
            raise EmailConnectionNotConfigured("Microsoft OAuth client is not configured")
        payload = await _post_form(_MICROSOFT_TOKEN_URL, {
            "refresh_token": refresh_token,
            "client_id": settings.microsoft_oauth_client_id,
            "client_secret": settings.microsoft_oauth_client_secret,
            "grant_type": "refresh_token",
            "scope": GRAPH_MAIL_READ_SCOPE,
        }, client=client)
        payload.setdefault("refresh_token", refresh_token)
        return _token_result(payload)


PROVIDERS: dict[str, EmailOAuthProvider] = {
    "gmail": GmailOAuthProvider(),
    "outlook": OutlookOAuthProvider(),
}


def redirect_uri_for(provider: str) -> str:
    settings = get_settings()
    base = (settings.email_oauth_redirect_base_url or settings.frontend_url or "").rstrip("/")
    return f"{base}/api/me/email-connections/{provider}/callback"
