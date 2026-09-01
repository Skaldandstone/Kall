"""Hosted billing contracts, verified raw bodies and product/user isolation."""

import json
import time
from datetime import datetime, timedelta

import pytest
import stripe
from billing_fakes import SCOPE, FakeStripe, delivery
from fastapi import HTTPException
from kall.config import get_settings
from kall.models import BillingEvent, Subscription, User
from kall.models.monitoring import MonitoringLease
from kall.services import stripe_billing
from sqlmodel import Session, select

pytestmark = pytest.mark.usefixtures("stripe_gateway")


@pytest.mark.parametrize("tamper", ["scope", "binding", "user", "customer", "live", "missing_price"])
def test_another_product_or_customer_never_grants_a_plan(client, engine, stripe_gateway, tamper):
    event = stripe_gateway.bind(engine, client.user_id)
    current = stripe_gateway.subscriptions["sub_local"]
    if tamper in {"scope", "binding", "user"}:
        key = {"scope": "kall_billing_scope", "binding": "kall_binding", "user": "kall_user_id"}[tamper]
        current["metadata"][key] = "foreign-product-or-owner"
    elif tamper == "customer":
        current["customer"] = "cus_someone_else"
    elif tamper == "live":
        current["livemode"] = True
    else:
        current["items"]["data"][0]["price"] = {"id": "price_foreign", "product": "prod_foreign", "livemode": False}
    assert delivery(client, event).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "free"


@pytest.mark.parametrize("kind", ["invalid", "old", "tampered", "live", "connect", "oversized"])
def test_rejects_unsafe_delivery_without_receipt(client, engine, stripe_gateway, kind):
    event = stripe_gateway.bind(engine, client.user_id)
    if kind == "invalid":
        response = client.post("/api/billing/webhook", content="{}", headers={"stripe-signature": "bad"})
    elif kind == "old":
        response = delivery(client, event, timestamp=int(time.time()) - 600)
    elif kind == "tampered":
        response = client.post("/api/billing/webhook", content=json.dumps(event), headers={"stripe-signature": f"t={int(time.time())},v1=wrong"})
    elif kind == "oversized":
        response = delivery(client, event, body=" " * (512 * 1024 + 1))
    else:
        event["livemode" if kind == "live" else "account"] = True if kind == "live" else "acct_other"
        response = delivery(client, event)
    assert response.status_code == (413 if kind == "oversized" else 400)
    with Session(engine) as session:
        assert session.exec(select(BillingEvent)).all() == []
    assert stripe_gateway.calls == []


@pytest.mark.parametrize("setting,value", [("stripe_enabled", False),
    ("stripe_secret_key", "rk_live_fake"), ("stripe_billing_scope", "studio:test"),
    ("stripe_webhook_secret", None), ("stripe_plus_product_id", "prod_kall_premium")])
def test_unconfigured_or_mismatched_billing_is_closed(client, stripe_gateway, monkeypatch, setting, value):
    monkeypatch.setattr(get_settings(), setting, value)
    assert client.post("/api/billing/checkout", json={"plan": "premium"}).status_code == 503
    assert client.post("/api/billing/portal").status_code == 503
    assert client.post("/api/billing/webhook", content="{}").status_code == 503
    assert stripe_gateway.calls == []


def test_live_checkout_and_webhook_require_live_objects_end_to_end(client, engine, monkeypatch):
    settings = get_settings()
    live = FakeStripe(livemode=True)
    for name, value in {
        "stripe_enabled": True,
        "stripe_livemode": True,
        "stripe_secret_key": "rk_live_local_placeholder",
        "stripe_billing_scope": SCOPE,
    }.items():
        monkeypatch.setattr(settings, name, value)
    monkeypatch.setattr(stripe_billing, "stripe_client", lambda: live)

    response = client.post("/api/billing/checkout", json={"plan": "plus"})
    assert response.status_code == 200
    with Session(engine) as session:
        row = session.exec(select(Subscription)).one()
        assert row.provider_livemode is True
        assert row.checkout_session_id.startswith("cs_live_")

    checkout = next(iter(live.checkouts.values()))
    current = {
        "id": "sub_live",
        "customer": checkout["customer"],
        "livemode": True,
        "metadata": checkout["metadata"],
        "status": "active",
        "items": {"data": [{"price": live.prices["price_plus"], "quantity": 1}]},
        "latest_invoice": {"id": "in_live", "status": "paid"},
    }
    live.subscriptions["sub_live"] = current
    event = live.event("sub_live", event_id="evt_live")
    assert delivery(client, event).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "plus"
        assert session.exec(select(BillingEvent)).one().payload_json["livemode"] is True

    event["id"] = "evt_wrong_mode"
    event["livemode"] = False
    assert delivery(client, event).status_code == 400


def test_checkout_uses_server_prices_owned_customer_and_one_persisted_attempt(client, engine, stripe_gateway):
    first = client.post("/api/billing/checkout", json={"plan": "plus"})
    second = client.post("/api/billing/checkout", json={"plan": "plus"})
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(stripe_gateway.customers) == len(stripe_gateway.checkouts) == 1
    calls = [call for call in stripe_gateway.calls if call[0] == "checkout.create"]
    assert len(calls) == 1
    params = calls[0][1]
    assert params["line_items"] == [{"price": "price_plus", "quantity": 1}]
    assert params["automatic_tax"] == {"enabled": False}
    assert "payment_method_types" not in params
    assert params["integration_identifier"].startswith("kall_")
    assert len(params["integration_identifier"].split("_")[1]) == 8
    assert abs(params["expires_at"] - time.time() - 3600) < 20
    assert params["subscription_data"]["metadata"]["kall_user_id"] == str(client.user_id)
    with Session(engine) as session:
        row = session.exec(select(Subscription)).one()
        assert row.provider_customer_id == params["customer"]
        assert row.checkout_session_id and row.checkout_attempt_key
        assert session.get(User, client.user_id).plan == "free"
    assert client.post("/api/billing/checkout", json={"plan": "premium"}).status_code == 409


@pytest.mark.parametrize("field", ["price", "customer", "user_id", "success_url", "subscription_data"])
def test_checkout_rejects_client_authority_fields(client, stripe_gateway, field):
    assert client.post("/api/billing/checkout", json={"plan": "plus", field: "untrusted"}).status_code == 422
    assert stripe_gateway.calls == []


@pytest.mark.parametrize("resource", ["customer", "checkout"])
def test_ambiguous_creation_reuses_persisted_idempotency_key(client, stripe_gateway, monkeypatch, resource):
    endpoint = stripe_gateway.v1.customers if resource == "customer" else stripe_gateway.v1.checkout.sessions
    original = endpoint.create
    attempts = []

    def lost_response(params, options):
        result = original(params, options)
        attempts.append(options["idempotency_key"])
        if len(attempts) == 1:
            raise stripe.APIConnectionError("Synthetic timeout after create")
        return result

    monkeypatch.setattr(endpoint, "create", lost_response)
    assert client.post("/api/billing/checkout", json={"plan": "plus"}).status_code == 503
    assert client.post("/api/billing/checkout", json={"plan": "plus"}).status_code == 200
    assert len(attempts) == 2 and attempts[0] == attempts[1]
    assert len(stripe_gateway.customers) == len(stripe_gateway.checkouts) == 1


def test_portal_uses_only_owned_customer_and_scoped_configuration(client, engine, stripe_gateway):
    stripe_gateway.bind(engine, client.user_id)
    assert client.post("/api/billing/portal").status_code == 200
    assert stripe_gateway.calls[-1] == ("portal.create", {"customer": "cus_local",
        "return_url": "http://localhost:3000/billing", "configuration": "bpc_kall"})
    stripe_gateway.customers["cus_local"]["metadata"]["kall_user_id"] = "another-user"
    assert client.post("/api/billing/portal").status_code == 503


def test_portal_rejects_foreign_catalog_and_legacy_unbound_customers(client, engine, stripe_gateway):
    stripe_gateway.bind(engine, client.user_id)
    stripe_gateway.configuration["features"]["subscription_update"]["products"][0]["prices"] = ["price_other_product"]
    assert client.post("/api/billing/portal").status_code == 503
    with Session(engine) as session:
        row = session.exec(select(Subscription)).one()
        row.billing_scope = None
        session.add(row)
        session.commit()
    assert client.post("/api/billing/portal").status_code == 503
    assert not any(call[0] == "portal.create" for call in stripe_gateway.calls)


@pytest.mark.parametrize("url", ["https://evil.test", "https://checkout.stripe.com.evil.test/", "javascript:alert(1)",
    "https://u:p@checkout.stripe.com/", "https://checkout.stripe.com:bad/", "http://checkout.stripe.com/"])
def test_provider_redirects_cannot_leave_hosted_checkout(url):
    with pytest.raises(HTTPException):
        stripe_billing.safe_url(url, "checkout.stripe.com")


def test_expired_lease_cannot_commit_entitlements(engine, client):
    with Session(engine) as session:
        with pytest.raises(HTTPException, match="lease expired"), stripe_billing.billing_transaction(session, client.user_id):
            user = session.get(User, client.user_id)
            user.plan = "premium"
            session.add(user)
            lease = session.exec(select(MonitoringLease)).one()
            lease.expires_at = datetime.utcnow() - timedelta(seconds=1)
            session.add(lease)
        session.expire_all()
        assert session.get(User, client.user_id).plan == "free"


def test_current_state_wins_over_old_events_and_same_timestamp(client, engine, stripe_gateway):
    old = stripe_gateway.bind(engine, client.user_id)
    old["created"] = 100
    assert delivery(client, old).status_code == 200
    stripe_gateway.subscriptions["sub_local"]["status"] = "canceled"
    newer = stripe_gateway.event(event_id="evt_cancel", event_type="customer.subscription.deleted")
    newer["created"] = 100
    assert delivery(client, newer).status_code == 200
    old["id"] = "evt_old_active_late"
    assert delivery(client, old).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "free"


def test_other_invoice_on_same_customer_cannot_recover_or_fail_kall(client, engine, stripe_gateway):
    event = stripe_gateway.bind(engine, client.user_id)
    assert delivery(client, event).status_code == 200
    stripe_gateway.subscriptions["sub_local"]["status"] = "past_due"
    stripe_gateway.subscriptions["sub_local"]["latest_invoice"]["status"] = "open"
    wrong_invoice = stripe_gateway.invoice(invoice_id="in_other", event_type="invoice.paid")
    assert delivery(client, wrong_invoice).json()["ignored"] is True
    with Session(engine) as session:
        row = session.exec(select(Subscription)).one()
        assert row.payment_failed_at is None and row.status == "active"
        record = session.exec(select(BillingEvent).where(BillingEvent.provider_event_id == "evt_invoice")).one()
        assert "customer_address" not in json.dumps(record.payload_json)


def test_real_sdk_client_serializes_version_idempotency_and_nested_response(monkeypatch):
    from urllib.parse import parse_qs

    requests = []

    def request(_self, method, url, headers, post_data=None, **kwargs):
        requests.append((method, url, headers, post_data))
        return json.dumps({"id": "cs_test_contract", "object": "checkout.session",
                           "customer": "cus_contract", "metadata": {"kall_user_id": "7"}}), 200, {}

    monkeypatch.setattr(stripe.RequestsClient, "request", request)
    client = stripe.StripeClient("rk_test_contract", stripe_version=stripe_billing.STRIPE_API_VERSION,
                                 http_client=stripe.RequestsClient(timeout=10))
    result = stripe_billing.provider_call(client.v1.checkout.sessions.create,
        {"mode": "subscription", "line_items": [{"price": "price_plus", "quantity": 1}],
         "integration_identifier": "kall_abcdefgh"}, {"idempotency_key": "kall-attempt"})
    assert result["metadata"] == {"kall_user_id": "7"}
    method, url, headers, body = requests[0]
    assert method == "post" and url.endswith("/v1/checkout/sessions")
    assert headers["Stripe-Version"] == stripe_billing.STRIPE_API_VERSION
    assert headers["Idempotency-Key"] == "kall-attempt"
    assert parse_qs(body)["line_items[0][price]"] == ["price_plus"]


def test_price_changes_use_actual_price_not_old_metadata(client, engine, stripe_gateway):
    from billing_fakes import price

    event = stripe_gateway.bind(engine, client.user_id)
    assert delivery(client, event).status_code == 200
    current = stripe_gateway.subscriptions["sub_local"]
    current["metadata"]["kall_plan"] = "premium"
    current["items"]["data"][0]["price"] = price("plus")
    current["cancel_at_period_end"] = True
    assert delivery(client, stripe_gateway.event(event_id="evt_price_change")).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "plus"
        assert session.exec(select(Subscription)).one().cancel_at_period_end is True


def test_cancelled_subscription_can_start_new_checkout_without_duplicate_customer(client, engine, stripe_gateway):
    assert client.post("/api/billing/checkout", json={"plan": "plus"}).status_code == 200
    checkout = next(iter(stripe_gateway.checkouts.values()))
    from billing_fakes import price

    current = {"id": "sub_created", "customer": checkout["customer"], "livemode": False,
               "metadata": checkout["metadata"], "status": "active",
               "items": {"data": [{"price": price("plus"), "quantity": 1}]}}
    stripe_gateway.subscriptions["sub_created"] = current
    checkout.update(status="complete", subscription="sub_created")
    assert client.post("/api/billing/checkout", json={"plan": "plus"}).status_code == 409
    assert delivery(client, stripe_gateway.event("sub_created")).status_code == 200
    assert client.post("/api/billing/checkout", json={"plan": "plus"}).status_code == 409
    current["status"] = "canceled"
    assert client.post("/api/billing/checkout", json={"plan": "premium"}).status_code == 200
    assert len(stripe_gateway.customers) == 1 and len(stripe_gateway.checkouts) == 2


def test_old_subscription_cannot_overwrite_new_subscription(client, engine, stripe_gateway):
    from copy import deepcopy

    event = stripe_gateway.bind(engine, client.user_id)
    assert delivery(client, event).status_code == 200
    newer = deepcopy(stripe_gateway.subscriptions["sub_local"])
    newer["id"] = "sub_newer"
    stripe_gateway.subscriptions["sub_newer"] = newer
    stripe_gateway.subscriptions["sub_local"]["status"] = "canceled"
    assert delivery(client, stripe_gateway.event("sub_newer", event_id="evt_newer")).status_code == 200
    assert delivery(client, stripe_gateway.event(event_id="evt_old_cancelled")).json()["ignored"] is True
    with Session(engine) as session:
        assert session.exec(select(Subscription)).one().provider_subscription_id == "sub_newer"
        assert session.get(User, client.user_id).plan == "premium"


def test_provider_failure_keeps_event_retryable_and_error_private(client, engine, stripe_gateway, monkeypatch):
    event = stripe_gateway.bind(engine, client.user_id)

    def unavailable(*args):
        raise stripe.APIConnectionError("private customer details")

    monkeypatch.setattr(stripe_gateway.v1.subscriptions, "retrieve", unavailable)
    response = delivery(client, event)
    assert response.status_code == 503 and "private customer details" not in response.text
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "free"
        assert session.exec(select(BillingEvent)).all() == []


def test_billing_status_never_exposes_bindings_and_routes_require_auth(client, engine, stripe_gateway):
    from kall.auth import get_current_user
    from kall.main import app

    stripe_gateway.bind(engine, client.user_id)
    assert client.get("/api/billing/status").json() == {"enabled": True, "can_manage": True}
    original = app.dependency_overrides.pop(get_current_user)
    try:
        for path in ("status", "checkout", "portal"):
            response = client.get(f"/api/billing/{path}") if path == "status" else client.post(f"/api/billing/{path}")
            assert response.status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = original


def test_separate_users_remain_separate_even_with_spoofed_event_metadata(client, engine, stripe_gateway):
    with Session(engine) as session:
        other = User(clerk_user_id="other_buyer", email="other@example.test", full_name="Other")
        session.add(other)
        session.commit()
        other_id = other.id
    stripe_gateway.bind(engine, client.user_id)
    event = stripe_gateway.bind(engine, other_id, suffix="other")
    event["data"]["object"]["metadata"]["kall_user_id"] = str(client.user_id)
    assert delivery(client, event).status_code == 200
    with Session(engine) as session:
        assert session.get(User, other_id).plan == "premium"
        assert session.get(User, client.user_id).plan == "free"
