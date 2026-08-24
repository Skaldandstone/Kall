import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import timedelta
from urllib.parse import urlencode

import httpx
import pyotp
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlmodel import Session, select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.structs import PublicKeyCredentialDescriptor, PublicKeyCredentialHint

from kall.auth import create_session, get_current_user, utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models import (
    AuthChallenge,
    CandidateProfile,
    OAuthIdentity,
    PasskeyCredential,
    User,
    UserCredential,
)
from kall.security import decrypt_sensitive, encrypt_sensitive

router = APIRouter(prefix="/auth", tags=["authentication"])


PROVIDERS = {
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "userinfo": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
    },
    "github": {
        "authorize": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token",
        "userinfo": "https://api.github.com/user",
        "emails": "https://api.github.com/user/emails",
        "scope": "read:user user:email",
    },
    "microsoft": {
        "authorize": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo": "https://graph.microsoft.com/oidc/userinfo",
        "scope": "openid email profile User.Read",
    },
    "linkedin": {
        "authorize": "https://www.linkedin.com/oauth/v2/authorization",
        "token": "https://www.linkedin.com/oauth/v2/accessToken",
        "userinfo": "https://api.linkedin.com/v2/userinfo",
        "scope": "openid profile email",
    },
}


class TotpCode(BaseModel):
    code: str


class PasskeyName(BaseModel):
    name: str = "Passkey"


class PasskeyPayload(BaseModel):
    challenge: str
    credential: dict
    name: str = "Passkey"


def _provider_credentials(provider: str) -> tuple[str, str]:
    settings = get_settings()
    client_id = getattr(settings, f"{provider}_oauth_client_id", None)
    secret = getattr(settings, f"{provider}_oauth_client_secret", None)
    if not client_id or not secret:
        raise HTTPException(503, f"{provider.title()} sign-in is not configured")
    return client_id, secret


def _state(provider: str, link_user_id: int | None = None) -> str:
    payload = {"provider": provider, "exp": int(time.time()) + 600, "nonce": secrets.token_urlsafe(16)}
    if link_user_id is not None:
        payload["link_user_id"] = link_user_id
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    signature = hmac.new(get_settings().app_secret_key.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{signature}"


def _verify_state(value: str, provider: str) -> dict:
    try:
        raw, signature = value.rsplit(".", 1)
        expected = hmac.new(get_settings().app_secret_key.encode(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        if payload["provider"] != provider or payload["exp"] < time.time():
            raise ValueError
    except Exception as exc:
        raise HTTPException(400, "Invalid or expired OAuth state") from exc
    return payload


def _callback_url(provider: str) -> str:
    # Deliberately built from the configured public origin rather than the
    # incoming request: this endpoint can be reached either directly (mobile,
    # and the OAuth provider's own redirect back) or proxied through the web
    # app's internal Service Connect hop (apps/web/app/api/kall/[...path]),
    # and request.url_for() would reflect whichever internal hop actually
    # received the request -- producing a redirect_uri that never matches
    # what's registered with the provider, or that isn't even publicly
    # reachable at all.
    return f"{get_settings().frontend_url.rstrip('/')}/api/auth/oauth/{provider}/callback"


@router.get("/providers")
def provider_status() -> dict[str, bool]:
    settings = get_settings()
    return {
        provider: bool(
            getattr(settings, f"{provider}_oauth_client_id", None)
            and getattr(settings, f"{provider}_oauth_client_secret", None)
        )
        for provider in PROVIDERS
    }


def _authorize_url(provider: str, link_user_id: int | None = None) -> str:
    client_id, _ = _provider_credentials(provider)
    definition = PROVIDERS[provider]
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": _callback_url(provider),
            "response_type": "code",
            "scope": definition["scope"],
            "state": _state(provider, link_user_id=link_user_id),
        }
    )
    return f"{definition['authorize']}?{query}"


@router.get("/oauth/{provider}/start")
def oauth_start(provider: str):
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown identity provider")
    return RedirectResponse(_authorize_url(provider))


@router.post("/oauth/{provider}/link/start")
def oauth_link_start(provider: str, current: User = Depends(get_current_user)) -> dict[str, str]:
    """Start linking an OAuth identity to the signed-in user's existing account.

    Unlike /oauth/{provider}/start (a plain link the browser navigates to), this
    requires a bearer token, so it returns the provider URL as JSON for the
    frontend to fetch and then navigate to itself.
    """
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown identity provider")
    return {"url": _authorize_url(provider, link_user_id=current.id)}


@router.get("/oauth/{provider}/callback", name="oauth_callback")
async def oauth_callback(provider: str, code: str, state: str, session: Session = Depends(get_session)):
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown identity provider")
    state_payload = _verify_state(state, provider)
    link_user_id = state_payload.get("link_user_id")
    client_id, client_secret = _provider_credentials(provider)
    definition = PROVIDERS[provider]
    async with httpx.AsyncClient(timeout=20) as client:
        token_response = await client.post(
            definition["token"],
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": _callback_url(provider),
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )
        token_response.raise_for_status()
        access_token = token_response.json().get("access_token")
        if not access_token:
            raise HTTPException(400, "Provider did not return an access token")
        user_response = await client.get(
            definition["userinfo"], headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
        )
        user_response.raise_for_status()
        profile = user_response.json()
        subject = str(profile.get("sub") or profile.get("id"))
        email = profile.get("email")
        if provider == "github" and not email:
            emails = await client.get(definition["emails"], headers={"Authorization": f"Bearer {access_token}"})
            if emails.is_success:
                primary = next((item for item in emails.json() if item.get("primary") and item.get("verified")), None)
                email = primary and primary.get("email")
        if not subject or not email:
            raise HTTPException(400, "The provider did not return a verified email address")
        email = email.strip().lower()
        name = profile.get("name") or profile.get("login") or email.split("@", 1)[0]

    identity = session.exec(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == provider, OAuthIdentity.provider_subject == subject
        )
    ).first()

    if link_user_id is not None:
        frontend = get_settings().frontend_url.rstrip("/")
        linked_user = session.get(User, link_user_id)
        error = None
        if not linked_user:
            error = "session_expired"
        elif identity and identity.user_id != linked_user.id:
            error = "already_connected"
        if error:
            return RedirectResponse(f"{frontend}/security-setup?error={error}&provider={provider}")
        if not identity:
            session.add(OAuthIdentity(user_id=linked_user.id, provider=provider, provider_subject=subject, email=email))
            session.commit()
        token = create_session(session, linked_user.id)
        return RedirectResponse(f"{frontend}/auth/complete#token={token}&next=/security-setup?linked={provider}")

    user = session.get(User, identity.user_id) if identity else None
    if not user:
        user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        user = User(email=email, full_name=name)
        session.add(user)
        session.commit()
        session.refresh(user)
        session.add(CandidateProfile(user_id=user.id, preferred_name=name))
    if not identity:
        session.add(OAuthIdentity(user_id=user.id, provider=provider, provider_subject=subject, email=email))
    session.commit()
    token = create_session(session, user.id)
    destination = f"{get_settings().frontend_url.rstrip('/')}/auth/complete#token={token}&next=/onboarding"
    return RedirectResponse(destination)


@router.get("/security")
def security_status(current: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    credential = session.exec(select(UserCredential).where(UserCredential.user_id == current.id)).first()
    passkeys = list(session.exec(select(PasskeyCredential).where(PasskeyCredential.user_id == current.id)))
    providers = list(session.exec(select(OAuthIdentity).where(OAuthIdentity.user_id == current.id)))
    return {
        "totp_enabled": bool(credential and credential.totp_enabled),
        "passkeys": [{"id": row.id, "name": row.name, "created_at": row.created_at} for row in passkeys],
        "providers": [row.provider for row in providers],
    }


@router.post("/totp/setup")
def totp_setup(current: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, str]:
    credential = session.exec(select(UserCredential).where(UserCredential.user_id == current.id)).first()
    if not credential:
        credential = UserCredential(user_id=current.id, password_hash="")
    secret = pyotp.random_base32()
    credential.totp_secret_encrypted = encrypt_sensitive(secret)
    credential.totp_enabled = False
    session.add(credential)
    session.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=current.email, issuer_name="Kall")
    return {"secret": secret, "otpauth_uri": uri}


@router.post("/totp/verify")
def totp_verify(payload: TotpCode, current: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, bool]:
    credential = session.exec(select(UserCredential).where(UserCredential.user_id == current.id)).first()
    secret = decrypt_sensitive(credential.totp_secret_encrypted) if credential else None
    if not credential or not secret or not pyotp.TOTP(secret).verify(payload.code, valid_window=1):
        raise HTTPException(422, "Invalid authenticator code")
    credential.totp_enabled = True
    session.add(credential)
    session.commit()
    return {"enabled": True}


@router.post("/passkeys/register/options")
def passkey_register_options(current: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    existing = list(session.exec(select(PasskeyCredential).where(PasskeyCredential.user_id == current.id)))
    options = generate_registration_options(
        rp_id=get_settings().webauthn_rp_id,
        rp_name=get_settings().webauthn_rp_name,
        user_id=str(current.id).encode(),
        user_name=current.email,
        user_display_name=current.full_name,
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64.urlsafe_b64decode(row.credential_id + "==")) for row in existing],
        # Prioritize the cross-device (QR code) flow over this device's own
        # platform authenticator, so "create a passkey" defaults to scan-with-
        # your-phone. The browser still lets the user pick this device instead.
        hints=[PublicKeyCredentialHint.HYBRID],
    )
    challenge = base64.urlsafe_b64encode(options.challenge).decode().rstrip("=")
    session.add(AuthChallenge(user_id=current.id, purpose="passkey_register", challenge=challenge, expires_at=utcnow() + timedelta(minutes=10)))
    session.commit()
    return json.loads(options_to_json(options))


@router.post("/passkeys/register/complete")
def passkey_register_complete(payload: PasskeyPayload, current: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, bool]:
    challenge = session.exec(select(AuthChallenge).where(AuthChallenge.challenge == payload.challenge, AuthChallenge.user_id == current.id, AuthChallenge.purpose == "passkey_register")).first()
    if not challenge or challenge.expires_at < utcnow() or challenge.consumed_at:
        raise HTTPException(400, "Invalid or expired passkey challenge")
    verified = verify_registration_response(
        credential=payload.credential,
        expected_challenge=base64.urlsafe_b64decode(payload.challenge + "=="),
        expected_rp_id=get_settings().webauthn_rp_id,
        expected_origin=get_settings().webauthn_origin,
    )
    session.add(PasskeyCredential(
        user_id=current.id,
        name=payload.name,
        credential_id=base64.urlsafe_b64encode(verified.credential_id).decode().rstrip("="),
        public_key=base64.urlsafe_b64encode(verified.credential_public_key).decode(),
        sign_count=verified.sign_count,
    ))
    challenge.consumed_at = utcnow()
    session.add(challenge)
    session.commit()
    return {"registered": True}


@router.post("/passkeys/login/options")
def passkey_login_options(email: str, session: Session = Depends(get_session)) -> dict:
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(404, "No passkey-enabled account found")
    credentials = list(session.exec(select(PasskeyCredential).where(PasskeyCredential.user_id == user.id)))
    if not credentials:
        raise HTTPException(404, "No passkey-enabled account found")
    options = generate_authentication_options(
        rp_id=get_settings().webauthn_rp_id,
        allow_credentials=[PublicKeyCredentialDescriptor(id=base64.urlsafe_b64decode(row.credential_id + "==")) for row in credentials],
    )
    challenge = base64.urlsafe_b64encode(options.challenge).decode().rstrip("=")
    session.add(AuthChallenge(user_id=user.id, purpose="passkey_login", challenge=challenge, expires_at=utcnow() + timedelta(minutes=10)))
    session.commit()
    return json.loads(options_to_json(options))


@router.post("/passkeys/login/complete")
def passkey_login_complete(payload: PasskeyPayload, session: Session = Depends(get_session)) -> dict[str, str]:
    challenge = session.exec(select(AuthChallenge).where(AuthChallenge.challenge == payload.challenge, AuthChallenge.purpose == "passkey_login")).first()
    if not challenge or not challenge.user_id or challenge.expires_at < utcnow() or challenge.consumed_at:
        raise HTTPException(400, "Invalid or expired passkey challenge")
    credential_id = payload.credential.get("id", "")
    row = session.exec(select(PasskeyCredential).where(PasskeyCredential.credential_id == credential_id, PasskeyCredential.user_id == challenge.user_id)).first()
    if not row:
        raise HTTPException(404, "Passkey not found")
    verified = verify_authentication_response(
        credential=payload.credential,
        expected_challenge=base64.urlsafe_b64decode(payload.challenge + "=="),
        expected_rp_id=get_settings().webauthn_rp_id,
        expected_origin=get_settings().webauthn_origin,
        credential_public_key=base64.urlsafe_b64decode(row.public_key),
        credential_current_sign_count=row.sign_count,
    )
    row.sign_count = verified.new_sign_count
    row.last_used_at = utcnow()
    challenge.consumed_at = utcnow()
    session.add(row)
    session.add(challenge)
    session.commit()
    return {"access_token": create_session(session, challenge.user_id)}
