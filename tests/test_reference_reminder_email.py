"""Reference email rendering is safe and never invents a confirmation."""

import pytest
from kall.models import NotificationDelivery
from kall.services.notification_delivery import _reference_reminder_email


def _delivery(**payload):
    return NotificationDelivery(
        user_id=1, channel="email", kind="reference_reminder", dedupe_key="reference:1",
        payload=payload,
    )


@pytest.mark.parametrize("baseline_source", ["last_confirmed_on", "created_at", None])
def test_reference_email_escapes_all_interpolated_html(baseline_source) -> None:
    delivery = _delivery(
        name='<img src=x onerror="bad()"> & Ada',
        organization="<a href='https://bad.example'>Acme</a>",
        last_confirmed_on="<script>bad()</script>",
        baseline_source=baseline_source,
    )
    subject, html = _reference_reminder_email(delivery)

    assert subject == f"Time to reconfirm: {delivery.payload['name']}"
    assert "&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; Ada" in html
    assert "&lt;a href=&#x27;https://bad.example&#x27;&gt;Acme&lt;/a&gt;" in html
    assert "&lt;script&gt;bad()&lt;/script&gt;" in html
    assert "<img" not in html
    assert "<a href=" not in html
    assert "<script>" not in html


def test_new_baseline_date_is_escaped_too() -> None:
    _, html = _reference_reminder_email(_delivery(
        name="Ada", baseline_source="created_at", baseline_date='<b>2026-01-01</b>',
    ))
    assert "Added to Kall on &lt;b&gt;2026-01-01&lt;/b&gt;" in html
    assert "<b>" not in html


def test_legacy_payload_is_neutral_about_confirmation_and_handles_missing_organization() -> None:
    _, html = _reference_reminder_email(_delivery(name="Ada", last_confirmed_on="2025-01-01"))
    assert "date saved with your reference: 2025-01-01" in html
    assert "confirmed on" not in html.lower()
    assert "Added to Kall on" not in html
    assert "None" not in html
