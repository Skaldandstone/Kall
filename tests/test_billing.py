from fastapi.routing import APIRoute


def _app_paths(app) -> set[str]:
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


def test_plus_plan_statuses_are_explicit():
    from kall.services.billing import ACTIVE_STATUSES

    assert {"active", "trialing"} == ACTIVE_STATUSES


def test_billing_routes_are_registered():
    from kall.main import app

    paths = _app_paths(app)
    assert "/api/billing/checkout" in paths
    assert "/api/billing/portal" in paths
    assert "/api/billing/webhook" in paths
    assert "/api/me/usage" in paths
