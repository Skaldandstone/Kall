from collections.abc import Iterator
from typing import Any

from fastapi.routing import APIRoute
from kall.main import app

PUBLIC_ROUTE_PATHS = {
    "/api/mobile-release",
    "/health",
    "/ready",
    "/testimonials/submit",
    "/testimonials/withdraw",
    "/billing/webhook",
    "/billing/revenuecat/webhook",
    "/career-pages/{slug}",
    "/shared-searches/{slug}",
    "/shared-searches/{slug}/criteria",
    "/shared-searches/{slug}/refresh",
    # The redirect back from Google/Microsoft's own server is a plain
    # browser navigation with no shared cookie or bearer token to check --
    # the signed, single-purpose `state` parameter is the authentication
    # here (see api_email_connections.py's _user_id_from_state), same
    # trust model as a testimonial's token_hash above.
    "/me/email-connections/{provider}/callback",
    # A mail client following List-Unsubscribe must be able to POST this with
    # no session and no user interaction at all (RFC 8058) -- the encrypted
    # token itself is the authentication, same trust model as the two routes
    # above.
    "/unsubscribe",
}
AUTHENTICATION_DEPENDENCIES = {
    "get_current_user",
    "get_verified_clerk_user_id",
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
