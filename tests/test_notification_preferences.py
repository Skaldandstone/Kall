"""Notification preferences: PUT existed with nothing exposing it to a
user, and no way to read it back at all -- a settings page could not have
even pre-filled a form. jobs/daily_brief.py already reads these values (or
its own matching defaults when no row exists); this is what lets a person
actually change them.
"""

from kall.models.opportunities import DeviceRegistration, NotificationPreference
from kall.security import decrypt_sensitive
from sqlmodel import Session, select


def test_reading_preferences_with_no_row_returns_the_model_defaults(client) -> None:
    response = client.get("/api/notification-preferences")
    assert response.status_code == 200
    body = response.json()
    assert body["email_enabled"] is True
    assert body["digest_hour_local"] == 8
    assert body["timezone"] == "UTC"


def test_setting_preferences_then_reading_them_back_agrees(client) -> None:
    updated = client.put(
        "/api/notification-preferences",
        json={
            "email_enabled": True,
            "push_enabled": False,
            "delivery_mode": "digest",
            "digest_hour_local": 19,
            "timezone": "America/Los_Angeles",
            "minimum_match_score": 70,
        },
    )
    assert updated.status_code == 200

    fetched = client.get("/api/notification-preferences").json()
    assert fetched["digest_hour_local"] == 19
    assert fetched["timezone"] == "America/Los_Angeles"


def test_updating_twice_edits_the_same_row_rather_than_creating_a_second_one(client, engine) -> None:
    client.put("/api/notification-preferences", json={"digest_hour_local": 10})
    client.put("/api/notification-preferences", json={"digest_hour_local": 21})

    with Session(engine) as session:
        rows = session.exec(
            select(NotificationPreference).where(NotificationPreference.user_id == client.user_id)
        ).all()
        assert len(rows) == 1
        assert rows[0].digest_hour_local == 21


def test_registering_a_device_encrypts_token_and_never_returns_it(client, engine) -> None:
    token = "ExponentPushToken[device-token-that-stays-private]"
    response = client.post(
        "/api/device-registrations",
        json={"platform": "android", "token": token},
    )

    assert response.status_code == 200
    assert token not in response.text
    assert set(response.json()) == {"id", "platform", "enabled", "last_seen_at"}
    with Session(engine) as session:
        row = session.exec(select(DeviceRegistration)).one()
        assert row.encrypted_token != token
        assert decrypt_sensitive(row.encrypted_token) == token
        assert row.token_hash != token


def test_registering_the_same_device_refreshes_one_row(client, engine) -> None:
    payload = {
        "platform": "android",
        "token": "ExponentPushToken[repeat-device-token-private]",
    }
    assert client.post("/api/device-registrations", json=payload).status_code == 200
    assert client.post("/api/device-registrations", json=payload).status_code == 200

    with Session(engine) as session:
        assert len(session.exec(select(DeviceRegistration)).all()) == 1


def test_device_registration_rejects_a_non_expo_token(client) -> None:
    response = client.post(
        "/api/device-registrations",
        json={"platform": "android", "token": "plain-device-token-that-is-invalid"},
    )
    assert response.status_code == 422
