"""The Adminhelper Worker needs machine-to-machine access to look up and
support users, distinct from /admin (Clerk-session, @skaldandstone.com email
gated -- see api_admin.py). This is /admin/portal, gated by a shared
X-Admin-Token instead, and disabled entirely when ADMIN_API_TOKEN is unset.
"""

import pytest
from kall.clock import utcnow
from kall.config import get_settings

TOKEN = "test-admin-token-0123456789abcdef"


@pytest.fixture
def admin_token(monkeypatch) -> str:
    monkeypatch.setattr(get_settings(), "admin_api_token", TOKEN)
    return TOKEN


def test_portal_routes_refuse_without_configured_token(client):
    assert get_settings().admin_api_token is None
    resp = client.get("/api/admin/portal/users", params={"email": "test"})
    assert resp.status_code == 401
    resp = client.get(
        "/api/admin/portal/users", params={"email": "test"}, headers={"X-Admin-Token": "guess"}
    )
    assert resp.status_code == 401


def test_portal_routes_refuse_wrong_token(client, admin_token):
    resp = client.get(
        "/api/admin/portal/users", params={"email": "test"}, headers={"X-Admin-Token": "wrong"}
    )
    assert resp.status_code == 401


def test_portal_routes_401_rather_than_500_on_a_non_ascii_token(client, admin_token):
    """hmac.compare_digest raises TypeError on non-ASCII str input -- a
    malformed header must 401 like any other wrong token, not 500.

    httpx refuses a non-ASCII str header value outright, so the raw bytes
    are sent as the header value directly -- what actually arrives over
    the wire from a real misbehaving client.
    """
    resp = client.get(
        "/api/admin/portal/users", params={"email": "test"}, headers={"X-Admin-Token": "wröng".encode()}
    )
    assert resp.status_code == 401


def test_portal_user_lookup_detail_and_active_toggle(client, admin_token):
    headers = {"X-Admin-Token": admin_token}

    resp = client.get("/api/admin/portal/users", params={"email": "test@"}, headers=headers)
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) == 1
    assert users[0]["email"] == "test@example.com"
    user_id = users[0]["id"]

    resp = client.get(f"/api/admin/portal/users/{user_id}", headers=headers)
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["clerk_user_id"] == "user_test_fixture"
    assert detail["application_count"] == 0
    assert detail["is_active"] is True

    resp = client.post(
        f"/api/admin/portal/users/{user_id}/active",
        json={"active": False, "staff_actor": "grace@skaldandstone.com"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    resp = client.get(f"/api/admin/portal/users/{user_id}/applications", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_portal_support_actions_change_plan_exemption_and_usage(client, admin_token, engine):
    """The support-tier actions the portal exposes: plan changes, lifting
    plan limits, and clearing the current period's counters. Each writes an
    actor-less AdminAction row carrying the forwarded staff_actor."""
    from kall.models.core import AdminAction
    from kall.services import quota
    from sqlmodel import Session, select

    headers = {"X-Admin-Token": admin_token}
    user_id = client.user_id  # type: ignore[attr-defined]

    detail = client.get(f"/api/admin/portal/users/{user_id}", headers=headers).json()
    assert detail["billing_exempt"] is False
    assert detail["usage"]["meters"]["applications"]["used"] == 0
    assert detail["plans"] == ["free", "plus", "premium"]

    resp = client.post(
        f"/api/admin/portal/users/{user_id}/plan",
        json={"plan": "premium", "reason": "comped", "staff_actor": "grace@skaldandstone.com"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["plan"] == "premium"
    resp = client.post(
        f"/api/admin/portal/users/{user_id}/plan", json={"plan": "platinum"}, headers=headers
    )
    assert resp.status_code == 422

    resp = client.post(
        f"/api/admin/portal/users/{user_id}/billing-exempt",
        json={"billing_exempt": True, "reason": "partner", "staff_actor": "grace@skaldandstone.com"},
        headers=headers,
    )
    assert resp.status_code == 200
    detail = client.get(f"/api/admin/portal/users/{user_id}", headers=headers).json()
    assert detail["billing_exempt"] is True
    assert detail["usage"]["meters"]["applications"]["limit"] is None

    with Session(engine) as session:
        from kall.models.core import User

        user = session.get(User, user_id)
        quota.consume(session, user, "applications", 3)

    resp = client.post(
        f"/api/admin/portal/users/{user_id}/reset-usage",
        json={"reason": "stuck counter", "staff_actor": "grace@skaldandstone.com"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["cleared"] == {"applications": 3}
    assert resp.json()["usage"]["meters"]["applications"]["used"] == 0

    with Session(engine) as session:
        actions = session.exec(
            select(AdminAction).where(AdminAction.target_user_id == user_id).order_by(AdminAction.id)
        ).all()
        assert [a.action for a in actions] == [
            "portal_set_plan", "portal_set_billing_exempt", "portal_reset_usage",
        ]
        assert all(a.actor_user_id is None for a in actions)
        assert all(a.actor_email == "grace@skaldandstone.com" for a in actions)
        assert actions[0].detail == {"from": "free", "to": "premium", "reason": "comped"}
        assert actions[2].detail["cleared"] == {"applications": 3}


def test_portal_unknown_user_404s(client, admin_token):
    headers = {"X-Admin-Token": admin_token}
    assert client.get("/api/admin/portal/users/999999", headers=headers).status_code == 404
    assert client.get("/api/admin/portal/users/999999/applications", headers=headers).status_code == 404
    assert client.get("/api/admin/portal/users/999999/pipeline", headers=headers).status_code == 404
    resp = client.post(
        "/api/admin/portal/users/999999/active", json={"active": False}, headers=headers
    )
    assert resp.status_code == 404


def test_portal_pipeline_inspector_reads_matches_and_applications(client, admin_token, engine):

    from kall.models.core import Application, CareerProfile, Job, JobMatch
    from sqlmodel import Session

    headers = {"X-Admin-Token": admin_token}
    user_id = client.user_id  # type: ignore[attr-defined]

    with Session(engine) as session:
        job = Job(source="test", company="Acme", title="Engineer", description="d", url="https://x/1")
        session.add(job)
        session.commit()
        session.refresh(job)

        career_profile = CareerProfile(user_id=user_id, name="Default")
        session.add(career_profile)
        session.commit()
        session.refresh(career_profile)

        session.add(JobMatch(
            user_id=user_id, career_profile_id=career_profile.id, job_id=job.id,
            score=82, recommendation="Strong match",
        ))
        session.add(Application(
            user_id=user_id, job_id=job.id, career_profile_id=career_profile.id,
            submitted_at=utcnow(),
        ))
        session.commit()

    resp = client.get(f"/api/admin/portal/users/{user_id}/pipeline", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["matches"]) == 1
    assert body["matches"][0]["company"] == "Acme"
    assert body["matches"][0]["score"] == 82
    assert len(body["applications"]) == 1


def test_portal_active_toggle_is_logged_without_a_clerk_actor(client, admin_token, engine):
    """A token caller has no Clerk User, so the audit row it writes has no
    actor_user_id -- but the forwarded staff_actor still lands in actor_email
    so the log isn't blank."""
    from kall.models.core import AdminAction
    from sqlmodel import Session, select

    headers = {"X-Admin-Token": admin_token}
    user_id = client.user_id  # type: ignore[attr-defined]

    resp = client.post(
        f"/api/admin/portal/users/{user_id}/active",
        json={"active": False, "staff_actor": "grace@skaldandstone.com"},
        headers=headers,
    )
    assert resp.status_code == 200

    with Session(engine) as session:
        action = session.exec(
            select(AdminAction).where(AdminAction.action == "portal_set_active")
        ).one()
        assert action.actor_user_id is None
        assert action.actor_email == "grace@skaldandstone.com"
        assert action.target_user_id == user_id
