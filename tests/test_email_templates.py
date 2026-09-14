"""Email presentation and MIME fallbacks stay branded and accessible."""

from types import SimpleNamespace

from kall.services import notifications
from kall.services.email_templates import (
    action_button,
    html_to_text,
    match_card,
    render_email_document,
)
from kall.services.notifications import NotificationService


def test_branded_document_has_logo_preheader_and_preferences(monkeypatch) -> None:
    monkeypatch.setattr(
        "kall.services.email_templates.get_settings",
        lambda: SimpleNamespace(frontend_url="https://kall.example"),
    )

    html = render_email_document(
        "Kall: Review your match",
        '<p>A useful next step.</p>' + action_button("Open Kall", "https://kall.example/jobs"),
    )

    assert html.startswith("<!doctype html>")
    assert 'lang="en"' in html
    assert 'src="https://kall.example/icon-192.png"' in html
    assert "Review your match" in html
    assert "A useful next step." in html
    assert "https://kall.example/settings/notifications" in html
    assert "@media only screen and (max-width:620px)" in html


def test_text_fallback_preserves_words_and_link_destinations() -> None:
    text = html_to_text(
        '<h2>Top matches</h2><p>Engineer &amp; artist</p>'
        '<a href="https://kall.example/jobs">Review matches</a>'
    )

    assert "Top matches" in text
    assert "Engineer & artist" in text
    assert "Review matches (https://kall.example/jobs)" in text
    assert "<" not in text


def test_match_card_escapes_provider_content() -> None:
    html = match_card("Engineer <Lead>", "North & South", 82)

    assert "Engineer &lt;Lead&gt;" in html
    assert "North &amp; South" in html
    assert "82%" in html
    assert "Engineer <Lead>" not in html


def test_ses_message_contains_html_and_plain_text(monkeypatch) -> None:
    sent: dict = {}

    class FakeSes:
        def send_email(self, **kwargs):
            sent.update(kwargs)
            return {"MessageId": "message-1"}

    monkeypatch.setattr(
        notifications,
        "get_settings",
        lambda: SimpleNamespace(
            ses_sender_email="support@kall.example",
            aws_region="us-east-2",
        ),
    )
    monkeypatch.setattr(
        "kall.services.email_templates.get_settings",
        lambda: SimpleNamespace(frontend_url="https://kall.example"),
    )
    monkeypatch.setattr(notifications, "_ses_client", lambda _region: FakeSes())

    message_id = NotificationService().send_email(
        "person@example.test",
        "Kall: Your morning brief",
        "<p>Your strongest match is ready.</p>",
        [],
    )

    assert message_id == "message-1"
    body = sent["Message"]["Body"]
    assert body["Html"]["Data"].startswith("<!doctype html>")
    assert body["Text"]["Data"] == "Your strongest match is ready."
    assert sent["Destination"] == {"ToAddresses": ["person@example.test"]}
