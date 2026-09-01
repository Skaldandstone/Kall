from collections.abc import Iterator
from typing import Any

from fastapi.routing import APIRoute
from kall.main import app

PUBLIC_ROUTE_PATHS = {
    "/health",
    "/ready",
    "/testimonials/submit",
    "/testimonials/withdraw",
    "/billing/webhook",
    "/career-pages/{slug}",
}
AUTHENTICATION_DEPENDENCIES = {
    "get_current_user",
    "require_admin_token",
}


def _api_routes(routes: list[Any]) -> Iterator[APIRoute]:
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif original_router := getattr(route, "original_router", None):
            yield from _api_routes(original_router.routes)


def _dependency_names(dependant: Any) -> set[str]:
    names: set[str] = set()
    for dependency in dependant.dependencies:
        names.add(getattr(dependency.call, "__name__", ""))
        names.update(_dependency_names(dependency))
    return names


def test_every_nonpublic_api_route_has_an_authentication_dependency() -> None:
    unprotected: list[str] = []
    seen_public: set[str] = set()

    for route in _api_routes(app.routes):
        if route.path in PUBLIC_ROUTE_PATHS:
            seen_public.add(route.path)
            continue
        dependencies = _dependency_names(route.dependant)
        if not dependencies.intersection(AUTHENTICATION_DEPENDENCIES):
            methods = ",".join(sorted(route.methods))
            unprotected.append(f"{methods} {route.path}")

    assert seen_public == PUBLIC_ROUTE_PATHS
    assert unprotected == []
