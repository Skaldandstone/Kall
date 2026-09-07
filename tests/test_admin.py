"""Administration.

These are mostly about who is refused. An admin surface that leaks is worse
than one that does not exist, and the whole authorization rule is a single
string comparison, so it is worth pinning down hard.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from kall.auth import get_current_user
from kall.db import get_session
from kall.main import app
from kall.models.core import AdminAction, User
from kall.models.enums import SubscriptionPlan
from kall.services import quota
from kall.services.admin import is_admin
from sqlmodel import Session, select


@pytest.fixture
def admin_client(engine):
    """A signed-in client on the admin domain."""
    with Session(engine) as setup:
        admin = User(
            clerk_user_id="user_admin",
            email="james@skaldandstone.com",
            full_name="Admin",
        )
        setup.add(admin)
        setup.commit()
        setup.refresh(admin)
        admin_id = admin.id

    def override_session():
        with Session(engine) as session:
            yield session

    def override_user() -> User:
        with Session(engine) as session:
            return session.get(User, admin_id)

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user
    try:
        with TestClient(app) as client:
            client.admin_id = admin_id  # type: ignore[attr-defined]
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_current_user, None)


def make_user(session: Session, email: str = "someone@example.com") -> User:
    user = User(clerk_user_id=f"user_{email}", email=email, full_name="Someone")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("james@skaldandstone.com", True),
        ("JAMES@SkaldAndStone.COM", True),
        ("  james@skaldandstone.com  ", True),
        ("play-reviewer@skaldandstone.com", False),
        (" PLAY-REVIEWER@SkaldAndStone.COM ", False),
        ("another-person@skaldandstone.com", False),
        ("james+reviewer@skaldandstone.com", False),
        # The ones that matter: near-misses that must not pass.
        ("james@skaldandstone.com.attacker.net", False),
        ("james@evil-skaldandstone.com", False),
        ("james@notskaldandstone.com", False),
        ("skaldandstone.com@example.com", False),
        ("james@example.com", False),
        ("", False),
    ],
)
def test_only_explicit_admin_accounts_count(email: str, expected: bool) -> None:
    assert is_admin(User(email=email, full_name="X")) is expected


def test_store_reviewer_cannot_read_or_mutate_admin_resources(client, engine) -> None:
    with Session(engine) as session:
        reviewer = session.get(User, client.user_id)
        reviewer.email = "play-reviewer@skaldandstone.com"
        session.add(reviewer)
        session.commit()

    for path in ("/api/admin/whoami", "/api/admin/users", "/api/admin/audit"):
        assert client.get(path).status_code == 404
    assert client.patch(
        f"/api/admin/users/{client.user_id}/billing-exempt",
        json={"billing_exempt": True},
    ).status_code == 404
    assert client.patch(
        f"/api/admin/users/{client.user_id}/plan",
        json={"plan": "premium"},
    ).status_code == 404
    assert client.request(
        "DELETE", f"/api/admin/users/{client.user_id}",
        json={"confirm_email": "play-reviewer@skaldandstone.com"},
    ).status_code == 404


def test_an_ordinary_account_gets_404_not_403(client) -> None:
    """Whether an admin surface exists is not an ordinary user's business."""
    for path in ("/api/admin/whoami", "/api/admin/users", "/api/admin/audit"):
        assert client.get(path).status_code == 404


def test_an_ordinary_account_cannot_grant_itself_an_exemption(client) -> None:
    response = client.patch(
        f"/api/admin/users/{client.user_id}/billing-exempt",
        json={"billing_exempt": True},
    )
    assert response.status_code == 404


def test_an_admin_can_find_and_read_an_account(admin_client, engine) -> None:
    with Session(engine) as session:
        target = make_user(session, "findme@example.com")
        target_id = target.id

    listed = admin_client.get("/api/admin/users?q=findme").json()
    assert [row["email"] for row in listed] == ["findme@example.com"]

    detail = admin_client.get(f"/api/admin/users/{target_id}").json()
    assert detail["plan"] == SubscriptionPlan.FREE
    assert detail["usage"]["meters"]["applications"]["limit"] == 5


def test_an_admin_sees_entitlement_not_content(admin_client, engine) -> None:
    """Support needs to know what an account may do, not what it contains."""
    with Session(engine) as session:
        target_id = make_user(session, "private@example.com").id

    body = admin_client.get(f"/api/admin/users/{target_id}").json()
    serialized = str(body).lower()
    for leaked in ("resume", "application_id", "extracted_text", "phone", "address"):
        assert leaked not in serialized


def test_setting_a_plan_is_recorded(admin_client, engine) -> None:
    with Session(engine) as session:
        target_id = make_user(session, "upgrade@example.com").id

    body = admin_client.patch(
        f"/api/admin/users/{target_id}/plan",
        json={"plan": "premium", "reason": "Comped for feedback"},
    ).json()
    assert body["plan"] == "premium"

    with Session(engine) as session:
        entry = session.exec(select(AdminAction)).one()
        assert entry.action == "set_plan"
        assert entry.actor_email == "james@skaldandstone.com"
        assert entry.detail == {"from": "free", "to": "premium", "reason": "Comped for feedback"}


def test_an_unknown_plan_is_refused(admin_client, engine) -> None:
    with Session(engine) as session:
        target_id = make_user(session, "bogus@example.com").id
    response = admin_client.patch(
        f"/api/admin/users/{target_id}/plan", json={"plan": "enterprise"}
    )
    assert response.status_code == 422


def test_exempting_an_account_lifts_its_limits(admin_client, engine) -> None:
    with Session(engine) as session:
        target = make_user(session, "dev@example.com")
        target_id = target.id
        quota.consume(session, target, "applications", amount=5)
        # Blocked before the exemption, so the assertion afterwards means
        # something.
        with pytest.raises(HTTPException):
            quota.check(session, target, "applications")

    admin_client.patch(
        f"/api/admin/users/{target_id}/billing-exempt",
        json={"billing_exempt": True, "reason": "Dev account"},
    )

    with Session(engine) as session:
        target = session.get(User, target_id)
        assert target.billing_exempt is True
        # No longer refused, and usage is still visible.
        quota.check(session, target, "applications")
        assert quota.used(session, target, "applications") == 5


def test_resetting_usage_clears_only_the_current_period(admin_client, engine) -> None:
    """It must not be usable to quietly rewrite an account's history."""
    from datetime import datetime

    with Session(engine) as session:
        target = make_user(session, "reset@example.com")
        target_id = target.id
        quota.consume(session, target, "applications", amount=4)
        old = quota.period_key("week", datetime(2020, 1, 15))
        session.add(
            quota.UsageCounter(user_id=target_id, meter="applications", period=old, used=99)
        )
        session.commit()

    admin_client.post(f"/api/admin/users/{target_id}/reset-usage", json={"billing_exempt": False, "reason": "Support"})

    with Session(engine) as session:
        target = session.get(User, target_id)
        assert quota.used(session, target, "applications") == 0
        historic = session.exec(
            select(quota.UsageCounter).where(quota.UsageCounter.period == old)
        ).one()
        assert historic.used == 99, "past periods must be left alone"


def test_the_audit_log_is_readable_and_scoped(admin_client, engine) -> None:
    with Session(engine) as session:
        first = make_user(session, "one@example.com").id
        second = make_user(session, "two@example.com").id

    admin_client.patch(f"/api/admin/users/{first}/plan", json={"plan": "plus"})
    admin_client.patch(f"/api/admin/users/{second}/plan", json={"plan": "premium"})

    assert len(admin_client.get("/api/admin/audit").json()) == 2
    scoped = admin_client.get(f"/api/admin/audit?target_user_id={first}").json()
    assert [row["target_user_id"] for row in scoped] == [first]


def test_there_is_no_way_to_edit_or_delete_an_audit_entry(admin_client, engine) -> None:
    with Session(engine) as session:
        target_id = make_user(session, "audited@example.com").id
    admin_client.patch(f"/api/admin/users/{target_id}/plan", json={"plan": "plus"})

    entry_id = admin_client.get("/api/admin/audit").json()[0]["id"]
    # TestClient.delete takes no body, so drive each verb through .request.
    for method in ("PATCH", "DELETE", "PUT"):
        response = admin_client.request(method, f"/api/admin/audit/{entry_id}")
        assert response.status_code in {404, 405}, f"{method} should not exist"


def test_an_admin_can_delete_an_account_with_confirmation(admin_client, engine) -> None:
    with Session(engine) as session:
        target = make_user(session, "gone@example.com")
        target_id = target.id

    refused = admin_client.request(
        "DELETE", f"/api/admin/users/{target_id}",
        json={"confirm_email": "wrong@example.com"},
    )
    assert refused.status_code == 422

    with Session(engine) as session:
        assert session.get(User, target_id) is not None, "a mismatched email must not delete anything"

    response = admin_client.request(
        "DELETE", f"/api/admin/users/{target_id}",
        json={"confirm_email": "GONE@example.com", "reason": "requested by user via support ticket"},
    )
    assert response.status_code == 204

    with Session(engine) as session:
        assert session.get(User, target_id) is None

    # Not filterable by target_user_id any more -- that is exactly the column
    # this deletion just nulled, which is why detail.target_email exists.
    audit = admin_client.get("/api/admin/audit").json()
    entry = next(row for row in audit if row["action"] == "delete_account")
    assert entry["detail"]["target_email"] == "gone@example.com"
    assert entry["detail"]["reason"] == "requested by user via support ticket"
    # The nulling this same deletion performs on AdminAction rows is what
    # makes target_user_id come back None here -- proof the two features
    # (deletion, preserved audit log) actually compose correctly end to end.
    assert entry["target_user_id"] is None
