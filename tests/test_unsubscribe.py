from kall.models.opportunities import NotificationPreference
from kall.security import unsubscribe_token, user_id_from_unsubscribe_token
from sqlmodel import Session, select


def test_unsubscribe_token_round_trips_and_rejects_garbage() -> None:
    token = unsubscribe_token(42)
    assert user_id_from_unsubscribe_token(token) == 42
    assert user_id_from_unsubscribe_token("garbage") is None

    tampered = token[:20] + ("A" if token[20] != "A" else "B") + token[21:]
    assert user_id_from_unsubscribe_token(tampered) is None


def test_valid_token_turns_off_email_and_needs_no_auth(client, engine) -> None:
    token = unsubscribe_token(client.user_id)

    response = client.get(f"/api/unsubscribe?token={token}")
    assert response.status_code == 200
    assert "Unsubscribed" in response.text

    with Session(engine) as session:
        preference = session.exec(
            select(NotificationPreference).where(NotificationPreference.user_id == client.user_id)
        ).one()
        assert preference.email_enabled is False


def test_post_is_what_one_click_mail_clients_actually_call(client, engine) -> None:
    token = unsubscribe_token(client.user_id)
    response = client.post(f"/api/unsubscribe?token={token}")
    assert response.status_code == 200

    with Session(engine) as session:
        preference = session.exec(
            select(NotificationPreference).where(NotificationPreference.user_id == client.user_id)
        ).one()
        assert preference.email_enabled is False


def test_invalid_token_is_refused(client) -> None:
    response = client.get("/api/unsubscribe?token=not-a-real-token")
    assert response.status_code == 404
