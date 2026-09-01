from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
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


def test_readiness_endpoint_checks_the_database() -> None:
    response = TestClient(app).get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_operations_routes_are_registered() -> None:
    paths = _app_paths()
    assert "/health" in paths
    assert "/ready" in paths
