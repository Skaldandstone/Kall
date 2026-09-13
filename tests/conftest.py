from collections.abc import Iterator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from kall import db as kall_db
from kall.auth import get_current_user, get_verified_clerk_user_id
from kall.db import get_session
from kall.main import app
from kall.models import CandidateProfile, User
from kall.rate_limit import limiter
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def stripe_gateway(monkeypatch):
    from billing_fakes import SCOPE, SECRET, FakeStripe
    from kall.config import get_settings
    from kall.services import stripe_billing

    settings = get_settings()
    for name, value in {
        "stripe_enabled": True, "stripe_livemode": False,
        "stripe_secret_key": "rk_test_local_placeholder", "stripe_webhook_secret": SECRET,
        "stripe_billing_scope": SCOPE, "stripe_price_id": "price_plus",
        "stripe_premium_price_id": "price_premium", "stripe_plus_product_id": "prod_kall_plus",
        "stripe_premium_product_id": "prod_kall_premium", "stripe_portal_configuration_id": "bpc_kall",
        "frontend_url": "http://localhost:3000",
    }.items():
        monkeypatch.setattr(settings, name, value)
    gateway = FakeStripe()
    monkeypatch.setattr(stripe_billing, "stripe_client", lambda: gateway)
    return gateway


@pytest.fixture(autouse=True)
def _no_real_job_posting_fetches(monkeypatch) -> None:
    # _import_job's BackgroundTasks enrichment (api_search_apply.py) makes a
    # real outbound HTTPS request to whatever URL a test payload happens to
    # use -- and several already use real, resolvable domains (linkedin.com,
    # indeed.com). Default every test to "no network, no enrichment" so that
    # is never a surprise; a test that wants to exercise the real behavior
    # monkeypatches this back itself.
    import kall.services.job_posting_schema as job_posting_schema
    monkeypatch.setattr(job_posting_schema, "fetch_job_posting_description", lambda *args, **kwargs: None)


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
def client(engine, monkeypatch) -> Iterator[TestClient]:
    """A signed-in TestClient, with identity stubbed at the dependency.

    Identity now lives in Clerk, so tests cannot mint a session by POSTing to
    a local /auth/register the way they used to. Overriding get_current_user
    is both closer to the truth (it is the app's single authentication seam)
    and cheaper -- no network, no Clerk test instance, no token plumbing in
    every test file. Tests that care about token verification itself exercise
    kall.auth directly instead.

    Exposes `client.user_id` for tests that need to seed rows against the user.

    Also points kall.db.engine at this same per-test in-memory database.
    Request-scoped code always gets the isolated engine via the get_session
    override above; anything that opens its own Session(engine) outside a
    request -- a BackgroundTasks callback, or a jobs/*.py script if one is
    ever exercised this way -- imports the engine directly and would
    otherwise silently reach whatever real database this process's own
    environment points at instead of the test's.
    """
    monkeypatch.setattr(kall_db, "engine", engine)
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
            user = session.get(User, user_id)
            # The real get_current_user never returns None -- an unresolvable
            # identity is a 401, not a null current_user. A test that deletes
            # this account mid-test (test_account_deletion.py) exercises that
            # exact path, and without this it would hit routes as `None` and
            # crash with an unrelated AttributeError instead.
            if user is None:
                raise HTTPException(status_code=401, detail="Invalid or expired session")
            return user

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_verified_clerk_user_id] = lambda: "user_test_fixture"
    try:
        with TestClient(app) as client:
            client.user_id = user_id  # type: ignore[attr-defined]
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_verified_clerk_user_id, None)
