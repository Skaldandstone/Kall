import pytest
from billing_fakes import delivery
from kall import api_billing
from kall.models import BillingEvent, Subscription, User
from sqlmodel import Session, select

pytestmark = pytest.mark.usefixtures("stripe_gateway")


def test_failure_after_entitlement_change_rolls_back_and_retry_finishes(client, engine, monkeypatch, stripe_gateway):
    event = stripe_gateway.bind(engine, client.user_id)
    original = api_billing._apply_event

    def fail_after_update(session, event):
        original(session, event)
        raise RuntimeError("simulated worker failure before commit")

    monkeypatch.setattr(api_billing, "_apply_event", fail_after_update)
    with pytest.raises(RuntimeError, match="simulated worker failure"):
        delivery(client, event)
    with Session(engine) as session:
        assert session.exec(select(BillingEvent)).all() == []
        assert session.exec(select(Subscription)).one().plan == "free"
        assert session.get(User, client.user_id).plan == "free"
    monkeypatch.setattr(api_billing, "_apply_event", original)
    assert delivery(client, event).status_code == 200
    assert delivery(client, event).json()["duplicate"] is True
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "premium"
        record = session.exec(select(BillingEvent)).one()
        assert record.status == "processed" and record.processed_at is not None


def test_pending_receipt_from_previous_release_is_recovered(client, engine, stripe_gateway):
    event = stripe_gateway.bind(engine, client.user_id)
    with Session(engine) as session:
        session.add(BillingEvent(provider_event_id=event["id"], event_type=event["type"]))
        session.commit()
    assert delivery(client, event).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "premium"
        assert session.exec(select(BillingEvent)).one().status == "processed"


def test_late_checkout_does_not_undo_subscription(client, engine, stripe_gateway):
    event = stripe_gateway.bind(engine, client.user_id)
    assert delivery(client, event).status_code == 200
    event.update(id="evt_checkout", type="checkout.session.completed")
    event["data"]["object"].update(id="cs_local", status="complete", subscription="sub_local")
    assert delivery(client, event).json()["ignored"] is True
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "premium"


def test_unknown_customer_metadata_cannot_create_binding(client, engine, stripe_gateway):
    event = stripe_gateway.bind(engine, client.user_id)
    event["data"]["object"]["customer"] = "cus_unknown"
    assert delivery(client, event).json()["ignored"] is True
    assert stripe_gateway.calls == []
    with Session(engine) as session:
        assert session.exec(select(BillingEvent)).all() == []


def test_concurrent_deliveries_create_one_processed_receipt(tmp_path, stripe_gateway):
    import asyncio
    import hashlib
    import hmac
    import json
    import time
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from billing_fakes import SECRET
    from fastapi import HTTPException
    from sqlmodel import SQLModel, create_engine
    from starlette.requests import Request

    engine = create_engine(f"sqlite:///{tmp_path / 'webhooks.db'}", connect_args={"timeout": 30})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(clerk_user_id="concurrent", email="concurrent@example.com", full_name="Buyer")
        session.add(user)
        session.commit()
        user_id = user.id
    body = json.dumps(stripe_gateway.bind(engine, user_id)).encode()
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
            try:
                return asyncio.run(api_billing.webhook(request, session))
            except HTTPException as exc:
                assert exc.status_code == 503
                return {"busy": True}

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: deliver(), range(2)))
        assert sum(bool(result.get("duplicate") or result.get("busy")) for result in results) == 1
        with Session(engine) as session:
            assert session.exec(select(BillingEvent)).one().status == "processed"
            assert session.get(User, user_id).plan == "premium"
    finally:
        engine.dispose()
