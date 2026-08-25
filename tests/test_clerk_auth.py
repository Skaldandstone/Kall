"""Tests for the Clerk <-> local-user seam.

`get_current_user` is the only authentication dependency in the backend, and
`ensure_local_user` is the only thing that creates application-side identity
rows now that sign-up happens inside Clerk. Both are worth guarding closely.
"""

import pytest
from fastapi import HTTPException
from kall.auth import ensure_local_user, get_current_user, verify_clerk_token
from kall.models import CandidateProfile, User
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def clerk_profile(monkeypatch: pytest.MonkeyPatch):
    """Stubs the one Clerk Backend API call ensure_local_user makes."""
    calls: list[str] = []

    def fake(clerk_user_id: str) -> tuple[str, str]:
        calls.append(clerk_user_id)
        return "ada@example.com", "Ada Lovelace"

    monkeypatch.setattr("kall.auth._clerk_profile", fake)
    return calls


def test_first_request_creates_both_the_user_and_the_candidate_profile(db: Session, clerk_profile) -> None:
    """CandidateProfile is the easy one to forget: GET /me/identity degrades to
    null fields rather than erroring when it is missing, so a gap here would
    surface as silently broken onboarding rather than a visible fault."""
    user = ensure_local_user(db, "user_abc123")

    assert user.clerk_user_id == "user_abc123"
    assert user.email == "ada@example.com"
    assert user.full_name == "Ada Lovelace"

    profile = db.exec(select(CandidateProfile).where(CandidateProfile.user_id == user.id)).first()
    assert profile is not None
    assert profile.preferred_name == "Ada Lovelace"


def test_second_request_reuses_the_same_rows_and_stops_calling_clerk(db: Session, clerk_profile) -> None:
    first = ensure_local_user(db, "user_abc123")
    second = ensure_local_user(db, "user_abc123")

    assert first.id == second.id
    assert len(db.exec(select(User)).all()) == 1
    assert len(db.exec(select(CandidateProfile)).all()) == 1
    # The Backend API is hit once per user, on first sight -- not per request.
    assert clerk_profile == ["user_abc123"]


def test_an_existing_account_with_the_same_email_is_adopted_rather_than_colliding(db: Session, clerk_profile) -> None:
    """User.email is unique, so a pre-existing row (a seeded fixture, or a Clerk
    account recreated against the same address) must be linked, not duplicated."""
    existing = User(email="ada@example.com", full_name="Ada (pre-Clerk)")
    db.add(existing)
    db.commit()
    db.refresh(existing)

    user = ensure_local_user(db, "user_abc123")

    assert user.id == existing.id
    assert user.clerk_user_id == "user_abc123"
    assert len(db.exec(select(User)).all()) == 1


def test_concurrent_first_requests_do_not_collide(engine, clerk_profile) -> None:
    """Regression: a freshly signed-in user's first page load fires several API
    calls at once. All of them arrive before any has committed, so all see no
    user and all try to insert the same row -- the losers hit the unique
    constraint on User.email and 500'd. Found by e2e, not by unit tests, because
    a single sequential call never races."""
    ids = []
    sessions = [Session(engine) for _ in range(4)]
    try:
        for s in sessions:
            # Read the id before the session closes -- a detached instance
            # cannot refresh its attributes.
            ids.append(ensure_local_user(s, "user_racy").id)
    finally:
        for s in sessions:
            s.close()

    assert len(set(ids)) == 1, f"every caller should get the same row, got {ids}"

    with Session(engine) as check:
        assert len(check.exec(select(User)).all()) == 1
        assert len(check.exec(select(CandidateProfile)).all()) == 1


def test_a_missing_bearer_token_is_rejected(db: Session) -> None:
    with pytest.raises(HTTPException) as caught:
        get_current_user(authorization=None, session=db)
    assert caught.value.status_code == 401


def test_a_malformed_authorization_header_is_rejected(db: Session) -> None:
    with pytest.raises(HTTPException) as caught:
        get_current_user(authorization="Basic abc123", session=db)
    assert caught.value.status_code == 401


def test_unconfigured_clerk_key_reports_503_rather_than_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """A deployment missing CLERK_SECRET_KEY should say so, not tell every user
    their session is invalid."""
    from kall.config import get_settings

    monkeypatch.delenv("CLERK_SECRET_KEY", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(HTTPException) as caught:
            verify_clerk_token("any.token.value")
        assert caught.value.status_code == 503
    finally:
        get_settings.cache_clear()


def test_an_inactive_user_is_rejected(db: Session, clerk_profile, monkeypatch: pytest.MonkeyPatch) -> None:
    user = ensure_local_user(db, "user_abc123")
    user.is_active = False
    db.add(user)
    db.commit()

    monkeypatch.setattr("kall.auth.verify_clerk_token", lambda token: {"sub": "user_abc123"})
    with pytest.raises(HTTPException) as caught:
        get_current_user(authorization="Bearer stub", session=db)
    assert caught.value.status_code == 401
