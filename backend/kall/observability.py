"""Sentry error tracking for the API.

Inert unless SENTRY_DSN is set, so local development and the test suite never
talk to Sentry. In production the DSN arrives as a plaintext task-definition
environment variable: a DSN only lets a client *send* events to one project,
which is why Sentry documents it as public and why it does not belong in
Secrets Manager next to the real secrets.

Kall handles EEO, work-authorization and other sensitive profile data, so the
default SDK behaviour is deliberately narrowed before anything leaves the
process: no request bodies, no headers, no cookies, no user identity, no
breadcrumbs of log lines, and no performance tracing. An error report carries
the exception, the stack, the route template and the method - enough to fix
the bug, and nothing that identifies whose request triggered it.
"""

from __future__ import annotations

import logging
from typing import Any

from kall.config import Settings

logger = logging.getLogger(__name__)

#: Keys removed from the outgoing event. `request` is rebuilt below with only
#: the method and URL template rather than dropped wholesale.
_DROPPED_EVENT_KEYS = ("user", "breadcrumbs")
_DROPPED_REQUEST_KEYS = ("headers", "cookies", "data", "query_string", "env")


def scrub_event(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """Strip anything that could identify a person from a Sentry event.

    Runs as Sentry's `before_send`, after the SDK has assembled the event and
    before it is serialised. Kept as a plain function of the event dict so the
    test suite can exercise it without a live client.
    """
    for key in _DROPPED_EVENT_KEYS:
        event.pop(key, None)

    request = event.get("request")
    if isinstance(request, dict):
        for key in _DROPPED_REQUEST_KEYS:
            request.pop(key, None)
        # The full URL may carry a slug or identifier in the path (career pages,
        # invitation tokens). The route template on the transaction is enough.
        request.pop("url", None)

    return event


def _drop_breadcrumb(crumb: dict[str, Any], hint: dict[str, Any] | None = None) -> None:
    # Breadcrumbs are log lines, SQL and outbound HTTP calls - each a channel
    # for a name or an email to slip into the report. None are kept.
    return None


def configure_sentry(settings: Settings) -> bool:
    """Initialise the Sentry SDK if a DSN is configured. Returns whether it did."""
    if not settings.sentry_dsn:
        return False

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment or settings.app_env,
        release=f"kall@{settings.app_version}",
        # Errors only. Tracing would attach every request's timing and URL to
        # the report stream, and Kall does not need it yet.
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=0.0,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub_event,
        before_breadcrumb=_drop_breadcrumb,
        integrations=[
            # Route templates (``/api/applications/{id}``), not concrete URLs,
            # as the transaction name. Only unhandled 5xx responses are
            # reported - 401/403/404/422 are normal control flow here.
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
    )
    logger.info(
        "Sentry error tracking enabled (environment=%s)",
        settings.sentry_environment or settings.app_env,
    )
    return True
