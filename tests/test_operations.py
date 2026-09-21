import json
from pathlib import Path

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from kall.api_ops import LATEST_ANDROID_VERSION
from kall.main import app


def _app_paths() -> set[str]:
    """Return all registered route paths, including those in included sub-routers."""
    paths: set[str] = set()
    for r in app.routes:
        if isinstance(r, APIRoute):
            paths.add(r.path)
        elif hasattr(r, "include_context") and hasattr(r, "original_router"):
            prefix = r.include_context.prefix or ""
            for sub in r.original_router.routes:
                if isinstance(sub, APIRoute):
                    paths.add(prefix + sub.path)
    return paths


def test_health_endpoint() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_mobile_release_endpoint_advertises_the_public_release() -> None:
    response = TestClient(app).get("/api/mobile-release")
    assert response.status_code == 200
    assert response.json() == {
        "platform": "android",
        "latestVersion": "1.2.0",
        "updateUrl": "https://play.google.com/store/apps/details?id=com.skaldandstone.kall",
    }

    app_config = json.loads((Path(__file__).parents[1] / "apps/mobile/app.json").read_text())
    packaged_version = tuple(int(part) for part in app_config["expo"]["version"].split("."))
    available_version = tuple(int(part) for part in LATEST_ANDROID_VERSION.split("."))
    assert packaged_version >= available_version
    assert response.headers["cache-control"] == "no-store"


def test_mobile_release_preserves_the_test_link_for_legacy_builds() -> None:
    legacy = TestClient(app).get("/api/mobile-release?installed=1.1.6")
    assert legacy.status_code == 200
    assert legacy.json()["updateUrl"] == "https://play.google.com/apps/testing/com.skaldandstone.kall"

    current = TestClient(app).get("/api/mobile-release?installed=1.2.0")
    assert current.status_code == 200
    assert current.json()["updateUrl"] == "https://play.google.com/store/apps/details?id=com.skaldandstone.kall"

    malformed = TestClient(app).get("/api/mobile-release?installed=not-a-version")
    assert malformed.status_code == 200
    assert malformed.json()["updateUrl"] == "https://play.google.com/store/apps/details?id=com.skaldandstone.kall"


def test_readiness_endpoint_checks_the_database() -> None:
    response = TestClient(app).get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_operations_routes_are_registered() -> None:
    paths = _app_paths()
    assert "/health" in paths
    assert "/ready" in paths
    assert "/api/mobile-release" in paths
