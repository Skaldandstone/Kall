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


def test_mobile_release_endpoint_matches_the_android_build() -> None:
    response = TestClient(app).get("/api/mobile-release")
    assert response.status_code == 200
    assert response.json() == {
        "platform": "android",
        "latestVersion": "1.0.4",
        "updateUrl": "https://play.google.com/apps/testing/com.skaldandstone.kall",
    }

    app_config = json.loads((Path(__file__).parents[1] / "apps/mobile/app.json").read_text())
    assert app_config["expo"]["version"] == LATEST_ANDROID_VERSION


def test_readiness_endpoint_checks_the_database() -> None:
    response = TestClient(app).get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_operations_routes_are_registered() -> None:
    paths = _app_paths()
    assert "/health" in paths
    assert "/ready" in paths
    assert "/api/mobile-release" in paths
