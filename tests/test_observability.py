"""Sentry error tracking is opt-in and never leaks who triggered an error.

Kall stores EEO, work-authorization and other sensitive profile fields, so the
question for an error tracker is not "does it capture exceptions" (the SDK
does that) but "what else rides along". These tests pin the two guarantees:
nothing initialises without a DSN, and the outgoing event is stripped of
every field that could identify a person or replay their request.
"""

import sentry_sdk
from kall.config import Settings
from kall.observability import configure_sentry, scrub_event


def _settings(**overrides) -> Settings:
    return Settings(app_env="development", database_url="sqlite://", **overrides)


def test_sentry_stays_inert_without_a_dsn() -> None:
    assert configure_sentry(_settings()) is False
    assert not sentry_sdk.is_initialized()


def test_sentry_initialises_with_a_dsn_and_reports_the_release() -> None:
    # A syntactically valid DSN for a project that does not exist. The SDK
    # never sends during init, so nothing leaves the process here.
    dsn = "https://0123456789abcdef0123456789abcdef@o1.ingest.us.sentry.io/1"
    try:
        assert configure_sentry(_settings(sentry_dsn=dsn, app_version="9.9.9")) is True
        client = sentry_sdk.get_client()
        assert client.is_active()
        assert client.options["release"] == "kall@9.9.9"
        assert client.options["environment"] == "development"
        assert client.options["send_default_pii"] is False
        assert client.options["traces_sample_rate"] == 0.0
        assert client.options["max_request_body_size"] == "never"
        assert client.options["include_local_variables"] is False
    finally:
        client.close()


def test_sentry_environment_overrides_app_env() -> None:
    dsn = "https://0123456789abcdef0123456789abcdef@o1.ingest.us.sentry.io/1"
    try:
        configure_sentry(_settings(sentry_dsn=dsn, sentry_environment="alpha-session"))
        client = sentry_sdk.get_client()
        assert client.options["environment"] == "alpha-session"
    finally:
        client.close()


def test_scrub_event_removes_identity_and_request_detail() -> None:
    event = {
        "exception": {"values": [{"type": "RuntimeError", "value": "boom"}]},
        "transaction": "/api/applications/{application_id}",
        "user": {"id": "user_123", "email": "someone@example.com", "ip_address": "10.0.0.1"},
        "breadcrumbs": {
            "values": [{"message": "SELECT * FROM candidateprofile WHERE email = ..."}]
        },
        "request": {
            "method": "POST",
            "url": "https://kall.skaldandstone.com/api/applications/42",
            "query_string": "token=abc",
            "headers": {"Authorization": "Bearer secret", "Cookie": "__session=x"},
            "cookies": {"__session": "x"},
            "data": {"eeo_ethnicity": "redacted-in-transit"},
            "env": {"REMOTE_ADDR": "10.0.0.1"},
        },
    }

    scrubbed = scrub_event(event, None)

    assert "user" not in scrubbed
    assert "breadcrumbs" not in scrubbed
    assert scrubbed["request"] == {"method": "POST"}
    # What is needed to fix the bug survives.
    assert scrubbed["exception"]["values"][0]["value"] == "boom"
    assert scrubbed["transaction"] == "/api/applications/{application_id}"


def test_scrub_event_tolerates_events_without_a_request() -> None:
    event = {"message": "background job failed", "level": "error"}
    assert scrub_event(dict(event), None) == event
