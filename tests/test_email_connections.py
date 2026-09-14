"""Phase 1 of email integration: connect/disconnect a read-only mailbox.

No real OAuth provider is ever contacted in these tests -- exchange_code and
authorize_url are monkeypatched directly on kall.services.email_oauth's
provider instances (module-qualified access, matching this codebase's own
documented monkeypatch-binding gotcha).
"""

from kall.models import EmailConnection
from kall.security import decrypt_sensitive
from kall.services import email_oauth
from kall.services.email_oauth import TokenResult
from sqlmodel import Session, select

API = "/api/me/email-connections"


def test_authorize_reports_not_configured_when_no_client_id_is_set(client) -> None:
    response = client.post(f"{API}/gmail/authorize")
    assert response.status_code == 503


def test_authorize_returns_a_consent_url_once_configured(client, monkeypatch) -> None:
    monkeypatch.setattr(email_oauth.get_settings(), "google_oauth_client_id", "test-client-id")
    response = client.post(f"{API}/gmail/authorize")
    assert response.status_code == 200, response.text
    url = response.json()["authorize_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth")
    assert "gmail.readonly" in url


def test_authorize_404s_on_an_unknown_provider(client) -> None:
    assert client.post(f"{API}/yahoo/authorize").status_code == 404


def test_callback_stores_encrypted_tokens_and_redirects(client, engine, monkeypatch) -> None:
    monkeypatch.setattr(email_oauth.get_settings(), "google_oauth_client_id", "test-client-id")
    monkeypatch.setattr(email_oauth.get_settings(), "google_oauth_client_secret", "test-secret")

    authorize_response = client.post(f"{API}/gmail/authorize")
    state = authorize_response.json()["authorize_url"].split("state=")[1].split("&")[0]
    import urllib.parse
    state = urllib.parse.unquote(state)

    async def fake_exchange(self, code, redirect_uri, *, client=None):
        assert code == "auth-code-123"
        return TokenResult(access_token="access-abc", refresh_token="refresh-xyz", expires_in=3600, scope="gmail.readonly")

    monkeypatch.setattr(email_oauth.GmailOAuthProvider, "exchange_code", fake_exchange)

    response = client.get(f"{API}/gmail/callback", params={"code": "auth-code-123", "state": state}, follow_redirects=False)
    assert response.status_code in (302, 307), response.text
    assert "connected=gmail" in response.headers["location"]

    with Session(engine) as session:
        connection = session.exec(select(EmailConnection).where(EmailConnection.user_id == client.user_id)).one()
        assert connection.provider == "gmail"
        assert connection.status == "connected"
        assert decrypt_sensitive(connection.access_token_encrypted) == "access-abc"
        assert decrypt_sensitive(connection.refresh_token_encrypted) == "refresh-xyz"
        assert connection.scope == "gmail.readonly"


def test_callback_rejects_a_state_signed_for_a_different_provider(client, monkeypatch) -> None:
    monkeypatch.setattr(email_oauth.get_settings(), "google_oauth_client_id", "test-client-id")
    monkeypatch.setattr(email_oauth.get_settings(), "microsoft_oauth_client_id", "test-ms-client-id")
    outlook_authorize = client.post(f"{API}/outlook/authorize")
    import urllib.parse
    state = urllib.parse.unquote(outlook_authorize.json()["authorize_url"].split("state=")[1].split("&")[0])

    response = client.get(f"{API}/gmail/callback", params={"code": "x", "state": state})
    assert response.status_code == 400


def test_callback_rejects_a_tampered_state(client, monkeypatch) -> None:
    monkeypatch.setattr(email_oauth.get_settings(), "google_oauth_client_id", "test-client-id")
    response = client.get(f"{API}/gmail/callback", params={"code": "x", "state": "garbage.notarealsignature"})
    assert response.status_code == 400


def test_callback_reports_not_configured_if_secret_was_never_set(client, monkeypatch) -> None:
    monkeypatch.setattr(email_oauth.get_settings(), "google_oauth_client_id", "test-client-id")
    authorize_response = client.post(f"{API}/gmail/authorize")
    import urllib.parse
    state = urllib.parse.unquote(authorize_response.json()["authorize_url"].split("state=")[1].split("&")[0])
    # google_oauth_client_secret was never set -- exchange_code must refuse.
    response = client.get(f"{API}/gmail/callback", params={"code": "x", "state": state})
    assert response.status_code == 503


def _connected(engine, user_id: int, provider: str = "gmail") -> int:
    with Session(engine) as session:
        connection = EmailConnection(user_id=user_id, provider=provider, access_token_encrypted="enc", status="connected")
        session.add(connection)
        session.commit()
        session.refresh(connection)
        return connection.id


def test_list_email_connections(client, engine) -> None:
    _connected(engine, client.user_id)
    response = client.get(API)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["provider"] == "gmail"
    # Never leaks the encrypted token blob to the client.
    assert "access_token_encrypted" not in data[0]


def test_disconnect_removes_the_row(client, engine) -> None:
    connection_id = _connected(engine, client.user_id)
    response = client.delete(f"{API}/{connection_id}")
    assert response.status_code == 200
    with Session(engine) as session:
        assert session.get(EmailConnection, connection_id) is None


def test_disconnect_someone_elses_connection_404s(client, engine) -> None:
    connection_id = _connected(engine, client.user_id + 1)
    response = client.delete(f"{API}/{connection_id}")
    assert response.status_code == 404
