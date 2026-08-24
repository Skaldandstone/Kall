from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from kall.config import get_settings
from kall.main import app


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
