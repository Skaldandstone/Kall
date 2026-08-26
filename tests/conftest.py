from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from kall.auth import get_current_user
from kall.db import get_session
from kall.main import app
from kall.models import CandidateProfile, User
from kall.rate_limit import limiter
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    # The limiter is a process-wide singleton keyed by remote address, and
    # TestClient's address is constant across every test in the same pytest
    # process -- without this, whichever test happens to exhaust a limit
    # first "poisons" every later test that hits the same endpoint.
    limiter.reset()


@pytest.fixture
def engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture
def client(engine) -> Iterator[TestClient]:
    """A signed-in TestClient, with identity stubbed at the dependency.

    Identity now lives in Clerk, so tests cannot mint a session by POSTing to
    a local /auth/register the way they used to. Overriding get_current_user
    is both closer to the truth (it is the app's single authentication seam)
    and cheaper -- no network, no Clerk test instance, no token plumbing in
    every test file. Tests that care about token verification itself exercise
    kall.auth directly instead.

    Exposes `client.user_id` for tests that need to seed rows against the user.
    """
    with Session(engine) as setup:
        user = User(clerk_user_id="user_test_fixture", email="test@example.com", full_name="Test User")
        setup.add(user)
        setup.commit()
        setup.refresh(user)
        # Mirrors what auth.ensure_local_user creates on first request, so
        # anything reading the identity profile behaves as it would in prod.
        setup.add(CandidateProfile(user_id=user.id, preferred_name=user.full_name))
        setup.commit()
        user_id = user.id

    def override_get_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    # Takes no parameters on purpose: FastAPI inspects an override's signature
    # and would try to build a request schema for anything declared here.
    def override_get_current_user() -> User:
        with Session(engine) as session:
            return session.get(User, user_id)

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        with TestClient(app) as client:
            client.user_id = user_id  # type: ignore[attr-defined]
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_current_user, None)
