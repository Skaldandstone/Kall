"""Authentication: verify Clerk's session token, resolve the local user.

Clerk owns identity — sign-in, sign-up, sessions, MFA, passkeys and social
connections. This module is the entire seam between Clerk and the rest of
the backend: `get_current_user` is the only authentication dependency in the
application, so every protected endpoint migrates by virtue of this one
function, with no per-endpoint change.
"""

from datetime import datetime

from clerk_backend_api import Clerk
from clerk_backend_api.security.types import TokenVerificationError, VerifyTokenOptions
from clerk_backend_api.security.verifytoken import verify_token
from fastapi import Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from kall.config import get_settings
from kall.db import get_session
from kall.models import AccountDeletionRecord, CandidateProfile, User


def utcnow() -> datetime:
    return datetime.utcnow()


def bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.removeprefix("Bearer ").strip()


def verify_clerk_token(token: str) -> dict:
    """Returns the verified session-token claims, or raises 401.

    The SDK caches the signing key by `kid` between calls (and evicts on
    rotation), so this is a network call on cold start, not per request.
    """
    settings = get_settings()
    if not settings.clerk_secret_key:
        # Better a clear 503 than a confusing 401 on every request when the
        # deployment is simply missing its key.
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    try:
        return verify_token(token, VerifyTokenOptions(secret_key=settings.clerk_secret_key))
    except TokenVerificationError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc


def _clerk_profile(clerk_user_id: str) -> tuple[str, str, dict]:
    """Fetches (email, full_name, public_metadata) from Clerk's Backend API.

    Clerk's session token carries only `sub`/`sid`/timestamps by default — no
    email or name — so the local row cannot be built from claims alone. This
    runs once per user, on the first request after sign-up, not per request.
    """
    settings = get_settings()
    with Clerk(bearer_auth=settings.clerk_secret_key) as clerk:
        account = clerk.users.get(user_id=clerk_user_id)

    email = next(
        (row.email_address for row in (account.email_addresses or []) if row.id == account.primary_email_address_id),
        None,
    ) or next((row.email_address for row in (account.email_addresses or [])), None)
    if not email:
        raise HTTPException(status_code=422, detail="Clerk account has no email address")

    full_name = " ".join(part for part in (account.first_name, account.last_name) if part).strip()
    metadata = account.public_metadata if isinstance(account.public_metadata, dict) else {}
    return email, full_name or email, metadata


def _assert_alpha_access(email: str, public_metadata: dict) -> None:
    settings = get_settings()
    if not settings.alpha_invite_only:
        return

    invited = public_metadata.get("alpha_access") is True
    owner_allowed = email.casefold() in settings.alpha_allowed_email_set
    if not invited and not owner_allowed:
        raise HTTPException(
            status_code=403,
            detail="This private alpha requires an invitation.",
        )


def _find_user(session: Session, clerk_user_id: str) -> User | None:
    return session.exec(select(User).where(User.clerk_user_id == clerk_user_id)).first()


def _was_deleted(session: Session, clerk_user_id: str) -> bool:
    return session.exec(
        select(AccountDeletionRecord).where(AccountDeletionRecord.clerk_user_id == clerk_user_id)
    ).first() is not None


def ensure_local_user(session: Session, clerk_user_id: str) -> User:
    """Resolves the local User for a Clerk id, creating it on first sight.

    Sign-up happens entirely inside Clerk, so nothing in this codebase runs at
    that moment. The local rows are therefore created lazily here, on the
    user's first authenticated request. A `user.created` webhook would race
    that first request and depend on delivery; this cannot.

    CandidateProfile is created alongside User deliberately: `GET /me/identity`
    degrades to null fields rather than erroring when it is missing, so a gap
    here surfaces as a silently broken onboarding rather than a visible fault.

    The check-then-insert here is deliberately racy-tolerant. A freshly signed-in
    user's first page load fires several API calls at once, and every one of them
    arrives before any has committed -- so they all see no user and all try to
    insert the same row. One wins; the rest must recover rather than 500. Losing
    that race is the normal case on first load, not an edge case.
    """
    user = _find_user(session, clerk_user_id)
    if user:
        return user

    if _was_deleted(session, clerk_user_id):
        # Without this, a browser whose Clerk session outlived its Kall
        # account -- deleting the local row does not sign anyone out of
        # Clerk -- would land right here and this function would build a
        # brand new account, silently undoing the deletion. See
        # services/account_deletion.py, which writes the row this checks and
        # tries to delete the Clerk user too; this is what still holds if
        # that call failed or the deployment has no Clerk key.
        raise HTTPException(status_code=401, detail="This account has been deleted")

    email, full_name, public_metadata = _clerk_profile(clerk_user_id)
    _assert_alpha_access(email, public_metadata)

    # An account may pre-exist by email (seeded fixture, or a Clerk account
    # recreated against the same address) -- adopt it rather than colliding
    # with the unique constraint on User.email.
    user = session.exec(select(User).where(User.email == email)).first()
    if user:
        user.clerk_user_id = clerk_user_id
    else:
        user = User(clerk_user_id=clerk_user_id, email=email, full_name=full_name)

    try:
        session.add(user)
        session.commit()
        session.refresh(user)
    except IntegrityError:
        session.rollback()
        user = _find_user(session, clerk_user_id) or session.exec(
            select(User).where(User.email == email)
        ).first()
        if user is None:
            raise

    profile = session.exec(select(CandidateProfile).where(CandidateProfile.user_id == user.id)).first()
    if not profile:
        try:
            session.add(CandidateProfile(user_id=user.id, preferred_name=full_name))
            session.commit()
        except IntegrityError:
            # CandidateProfile.user_id is unique; a parallel request got there first.
            session.rollback()
    return user


def get_current_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> User:
    claims = verify_clerk_token(bearer_token(authorization))
    clerk_user_id = claims.get("sub")
    if not clerk_user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user = ensure_local_user(session, clerk_user_id)
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Inactive user")
    return user
