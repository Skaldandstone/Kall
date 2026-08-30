import hashlib
import hmac
import json
import time

import pytest
from kall import api_billing
from kall.config import get_settings
from kall.models import BillingEvent, Subscription, User
from sqlmodel import Session, select

SECRET = "whsec_local_test_only"


def delivery(client, event):
    body = json.dumps(event)
    timestamp = str(int(time.time()))
    digest = hmac.new(SECRET.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    return client.post(
        "/api/billing/webhook", content=body,
        headers={"stripe-signature": f"t={timestamp},v1={digest}"},
    )


def subscription_event(user_id):
    return {
        "id": "evt_retry", "object": "event", "livemode": False,
        "type": "customer.subscription.created",
        "data": {"object": {
            "id": "sub_local", "customer": "cus_local", "status": "active",
            "metadata": {"kall_user_id": str(user_id), "kall_plan": "premium"},
        }},
    }


@pytest.fixture(autouse=True)
def webhook_secret(monkeypatch):
    monkeypatch.setattr(get_settings(), "stripe_webhook_secret", SECRET)
    monkeypatch.setattr(get_settings(), "stripe_livemode", False)


def test_failure_after_entitlement_change_rolls_back_and_retry_finishes(client, engine, monkeypatch):
    event = subscription_event(client.user_id)
    original = api_billing._apply_event

    def fail_after_update(session, event):
        original(session, event)
        raise RuntimeError("simulated worker failure before commit")

    monkeypatch.setattr(api_billing, "_apply_event", fail_after_update)
    with pytest.raises(RuntimeError, match="simulated worker failure"):
        delivery(client, event)
    with Session(engine) as session:
        assert session.exec(select(BillingEvent)).all() == []
        assert session.exec(select(Subscription)).all() == []
        assert session.get(User, client.user_id).plan == "free"

    monkeypatch.setattr(api_billing, "_apply_event", original)
    assert delivery(client, event).status_code == 200
    assert delivery(client, event).json()["duplicate"] is True
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "premium"
        records = session.exec(select(BillingEvent)).all()
        assert len(records) == 1
        assert records[0].status == "processed"
        assert records[0].processed_at is not None


def test_pending_receipt_from_previous_release_is_recovered(client, engine):
    event = subscription_event(client.user_id)
    with Session(engine) as session:
        session.add(BillingEvent(provider_event_id=event["id"], event_type=event["type"]))
        session.commit()
    assert delivery(client, event).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "premium"
        assert session.exec(select(BillingEvent)).one().status == "processed"


def test_late_checkout_does_not_undo_subscription(client, engine):
    assert delivery(client, subscription_event(client.user_id)).status_code == 200
    checkout = subscription_event(client.user_id)
    checkout.update(id="evt_checkout", type="checkout.session.completed")
    checkout["data"]["object"].update(id="cs_local", status="complete", subscription="sub_local")
    assert delivery(client, checkout).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "premium"


def test_another_apps_generic_reference_does_not_grant_a_plan(client, engine):
    event = subscription_event(client.user_id)
    event["data"]["object"].update(metadata={}, client_reference_id=str(client.user_id))
    assert delivery(client, event).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "free"


def test_invalid_signature_creates_no_receipt(client, engine):
    response = client.post("/api/billing/webhook", content="{}", headers={"stripe-signature": "bad"})
    assert response.status_code == 400
    with Session(engine) as session:
        assert session.exec(select(BillingEvent)).all() == []


def test_live_delivery_is_rejected_by_sandbox(client, engine):
    event = subscription_event(client.user_id)
    event["livemode"] = True
    assert delivery(client, event).status_code == 400
    with Session(engine) as session:
        assert session.exec(select(BillingEvent)).all() == []


def test_live_key_is_rejected_by_sandbox(monkeypatch):
    from fastapi import HTTPException
    from kall.services.billing import validate_key_environment

    monkeypatch.setattr(get_settings(), "stripe_secret_key", "rk_live_local_placeholder")
    with pytest.raises(HTTPException, match="environment does not match"):
        validate_key_environment()
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "rk_test_local_placeholder")
    validate_key_environment()


def test_concurrent_deliveries_create_one_processed_receipt(tmp_path):
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from sqlmodel import SQLModel, create_engine
    from starlette.requests import Request

    engine = create_engine(f"sqlite:///{tmp_path / 'webhooks.db'}", connect_args={"timeout": 30})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(clerk_user_id="concurrent", email="concurrent@example.com", full_name="Buyer")
        session.add(user)
        session.commit()
        user_id = user.id
    body = json.dumps(subscription_event(user_id)).encode()
    timestamp = str(int(time.time()))
    digest = hmac.new(SECRET.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    barrier = Barrier(2)

    def deliver():
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request({"type": "http", "headers": [
            (b"stripe-signature", f"t={timestamp},v1={digest}".encode()),
        ]}, receive)
        barrier.wait(timeout=10)
        with Session(engine) as session:
            return asyncio.run(api_billing.webhook(request, session))

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: deliver(), range(2)))
        assert sum(bool(result.get("duplicate")) for result in results) == 1
        with Session(engine) as session:
            assert session.exec(select(BillingEvent)).one().status == "processed"
            assert session.get(User, user_id).plan == "premium"
    finally:
        engine.dispose()
