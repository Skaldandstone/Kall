"""The extension calls the API directly now, from its own chrome-extension://
origin, not through the web app's cookie-based proxy -- see
apps/extension/src/api.js. CORS is the one thing standing between that origin
and every request; a wrong or missing entry here fails silently in the
browser (a console CORS error, not anything the extension's own error
handling can catch or explain), so it is worth pinning down directly rather
than trusting the config was typed correctly.
"""

from fastapi.testclient import TestClient
from kall.main import app

EXTENSION_ORIGIN = "chrome-extension://lgbplmcainecdbbkameldmpafdcnpaid"


def test_the_extension_origin_passes_a_cors_preflight() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/api/applications",
            headers={
                "Origin": EXTENSION_ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == EXTENSION_ORIGIN


def test_an_unrelated_origin_does_not_pass() -> None:
    """The allowlist must still be an allowlist, not effectively open."""
    with TestClient(app) as client:
        response = client.options(
            "/api/applications",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
    assert "access-control-allow-origin" not in response.headers
