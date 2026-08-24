from collections.abc import Iterator
from urllib.parse import parse_qs, unquote, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from kall.api_security import _verify_state
from kall.config import get_settings
from kall.db import get_session
from kall.main import app
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture
def oauth_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
        get_settings.cache_clear()


def test_oauth_start_redirects_to_the_public_callback_url(oauth_client: TestClient) -> None:
    """Regression test: the redirect_uri sent to the provider must always be
    built from the configured public frontend_url, not from whatever host
    happened to receive the request. In production this endpoint can be
    reached either directly (the public /api/* ALB path) or proxied through
    the web app's internal Service Connect hop -- request.url_for() reflected
    whichever one actually received the request, producing a redirect_uri
    the provider would reject (or that pointed at an internal-only hostname).
    Simulate the internal-hop case here via a custom Host header.
    """
    response = oauth_client.get(
        "/api/auth/oauth/google/start",
        headers={"Host": "kall-api.kall.local:8000"},
        follow_redirects=False,
    )
    assert response.status_code in (302, 307)
    location = response.headers["location"]
    redirect_uri = parse_qs(urlparse(location).query)["redirect_uri"][0]
    assert redirect_uri == f"{get_settings().frontend_url.rstrip('/')}/api/auth/oauth/google/callback"


def test_oauth_start_rejects_unknown_provider(oauth_client: TestClient) -> None:
    response = oauth_client.get("/api/auth/oauth/not-a-real-provider/start")
    assert response.status_code == 404


@pytest.fixture
def authed_oauth_client(oauth_client: TestClient) -> Iterator[TestClient]:
    """An oauth_client that's also logged in, for the /link/start endpoint
    which requires a bearer token (unlike /start, a plain browser link).
    """
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def override_get_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        register = oauth_client.post(
            "/api/auth/register",
            json={"email": "oauth-link@example.com", "password": "TestPassword123!", "full_name": "Link Test"},
        )
        oauth_client.headers["Authorization"] = f"Bearer {register.json()['access_token']}"
        yield oauth_client
    finally:
        app.dependency_overrides.pop(get_session, None)


def _state_from_authorize_url(url: str) -> dict:
    state = parse_qs(urlparse(url).query)["state"][0]
    return _verify_state(state, "google")


def test_link_start_passes_through_an_allowed_return_to(authed_oauth_client: TestClient) -> None:
    """Regression test: connecting a provider from the security-setup modal
    on /onboarding used to always send the user back to /security-setup
    after linking, because the callback's redirect destination was
    hardcoded. return_to threads the caller's actual page through the
    signed OAuth state so the callback can send them back to it.
    """
    response = authed_oauth_client.post("/api/auth/oauth/google/link/start?return_to=/onboarding")
    assert response.status_code == 200
    payload = _state_from_authorize_url(response.json()["url"])
    assert payload["return_to"] == "/onboarding"


def test_link_start_drops_a_return_to_outside_the_allowlist(authed_oauth_client: TestClient) -> None:
    """A return_to value flows through an unauthenticated third-party
    redirect, so anything outside the fixed allowlist must be dropped
    rather than trusted as an open-redirect target.
    """
    response = authed_oauth_client.post("/api/auth/oauth/google/link/start?return_to=https://evil.example.com")
    assert response.status_code == 200
    payload = _state_from_authorize_url(response.json()["url"])
    assert "return_to" not in payload


def test_oauth_callback_link_flow_redirects_to_the_original_return_to(authed_oauth_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    start = authed_oauth_client.post("/api/auth/oauth/google/link/start?return_to=/onboarding")
    authorize_url = start.json()["url"]
    state = parse_qs(urlparse(authorize_url).query)["state"][0]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "fake-access-token"})
        return httpx.Response(200, json={"sub": "google-subject-123", "email": "oauth-link@example.com"})

    class FakeAsyncClient(httpx.AsyncClient):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            kwargs["base_url"] = "https://provider.test"
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        "kall.api_security.PROVIDERS",
        {**__import__("kall.api_security", fromlist=["PROVIDERS"]).PROVIDERS, "google": {
            "authorize": "https://provider.test/authorize",
            "token": "https://provider.test/token",
            "userinfo": "https://provider.test/userinfo",
            "scope": "openid email profile",
        }},
    )

    response = authed_oauth_client.get(
        f"/api/auth/oauth/google/callback?code=fake-code&state={state}", follow_redirects=False,
    )
    assert response.status_code in (302, 307)
    location = unquote(response.headers["location"])
    assert "/onboarding?linked=google" in location
