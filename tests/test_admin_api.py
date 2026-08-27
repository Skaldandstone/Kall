import pytest
from kall.config import get_settings

TOKEN = "test-admin-token-0123456789abcdef"


@pytest.fixture
def admin_token(monkeypatch) -> str:
    monkeypatch.setattr(get_settings(), "admin_api_token", TOKEN)
    return TOKEN


def test_admin_routes_refuse_without_configured_token(client):
    # No ADMIN_API_TOKEN configured: the surface is disabled outright, even
    # for a caller presenting some header value.
    assert get_settings().admin_api_token is None
    resp = client.get("/api/admin/users", params={"email": "test"})
    assert resp.status_code == 401
    resp = client.get(
        "/api/admin/users", params={"email": "test"}, headers={"X-Admin-Token": "guess"}
    )
    assert resp.status_code == 401


def test_admin_routes_refuse_wrong_token(client, admin_token):
    resp = client.get(
        "/api/admin/users", params={"email": "test"}, headers={"X-Admin-Token": "wrong"}
    )
    assert resp.status_code == 401


def test_admin_user_lookup_detail_and_toggle(client, admin_token):
    headers = {"X-Admin-Token": admin_token}

    resp = client.get("/api/admin/users", params={"email": "test@"}, headers=headers)
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) == 1
    assert users[0]["email"] == "test@example.com"
    user_id = users[0]["id"]

    resp = client.get(f"/api/admin/users/{user_id}", headers=headers)
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["clerk_user_id"] == "user_test_fixture"
    assert detail["application_count"] == 0
    assert detail["is_active"] is True

    resp = client.post(
        f"/api/admin/users/{user_id}/active", json={"active": False}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    resp = client.get(f"/api/admin/users/{user_id}/applications", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_admin_unknown_user_404s(client, admin_token):
    headers = {"X-Admin-Token": admin_token}
    assert client.get("/api/admin/users/99999", headers=headers).status_code == 404
