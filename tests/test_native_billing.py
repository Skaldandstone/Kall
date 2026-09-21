import hashlib
import hmac
import json
import time
from datetime import timedelta

from kall.clock import utcnow
from kall.config import get_settings
from kall.models import BillingEvent, StoreSubscription, Subscription, User
from sqlmodel import Session, select

AUTHORIZATION = "Bearer revenuecat-test-webhook"
SIGNING_SECRET = "revenuecat-test-signing-secret"
GOOGLE_PLUS = "kall_plus:kall-plus-monthly"
GOOGLE_PREMIUM = "kall_premium:kall-premium-monthly"
APPLE_PLUS = "com.skaldandstone.kall.plus.monthly"
APPLE_PREMIUM = "com.skaldandstone.kall.premium.monthly"


def _configure(monkeypatch, environments="PRODUCTION"):
    settings = get_settings()
    for name, value in {
        "revenuecat_enabled": True,
        "revenuecat_webhook_authorization": AUTHORIZATION,
        "revenuecat_webhook_signing_secret": SIGNING_SECRET,
        "revenuecat_accepted_environments": environments,
        "revenuecat_google_plus_product_id": GOOGLE_PLUS,
        "revenuecat_google_premium_product_id": GOOGLE_PREMIUM,
        "revenuecat_apple_plus_product_id": APPLE_PLUS,
        "revenuecat_apple_premium_product_id": APPLE_PREMIUM,
    }.items():
        monkeypatch.setattr(settings, name, value)


def _event(event_id: str, event_type="INITIAL_PURCHASE", **overrides):
    now_ms = int(time.time() * 1000)
    event = {
        "id": event_id,
        "type": event_type,
        "event_timestamp_ms": now_ms,
        "app_user_id": "user_test_fixture",
        "original_app_user_id": "user_test_fixture",
        "aliases": [],
        "store": "PLAY_STORE",
        "environment": "PRODUCTION",
        "product_id": GOOGLE_PLUS,
        "original_transaction_id": "GPA.1234-5678-9012-34567",
        "expiration_at_ms": now_ms + int(timedelta(days=30).total_seconds() * 1000),
    }
    event.update(overrides)
    return {"api_version": "1.0", "event": event}


def _post(client, payload, *, authorization=AUTHORIZATION, secret=SIGNING_SECRET, timestamp=None):
    body = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = timestamp or int(time.time())
    signature = hmac.new(
        secret.encode(), str(timestamp).encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    return client.post(
        "/api/billing/revenuecat/webhook",
        content=body,
        headers={
            "content-type": "application/json",
            "authorization": authorization,
            "x-revenuecat-webhook-signature": f"t={timestamp},v1={signature}",
        },
    )


def test_revenuecat_webhook_requires_configuration_and_both_secrets(client, monkeypatch):
    payload = _event("evt-disabled")
    assert _post(client, payload).status_code == 404

    _configure(monkeypatch)
    assert _post(client, payload, authorization="Bearer wrong").status_code == 400
    assert _post(client, payload, secret="wrong").status_code == 400
    assert _post(client, payload, timestamp=int(time.time()) - 301).status_code == 400


def test_google_purchase_grants_plan_once_and_status_reports_source(client, engine, monkeypatch):
    _configure(monkeypatch)
    payload = _event("evt-purchase")
    response = _post(client, payload)
    assert response.status_code == 200
    assert response.json() == {"received": True, "ignored": False}
    assert _post(client, payload).json() == {"received": True, "duplicate": True}

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        rows = session.exec(select(StoreSubscription)).all()
        events = session.exec(select(BillingEvent).where(BillingEvent.provider == "revenuecat")).all()
        assert user.plan == "plus"
        assert len(rows) == len(events) == 1
        assert rows[0].store == "PLAY_STORE" and rows[0].environment == "PRODUCTION"
    assert client.get("/api/billing/status").json()["sources"] == ["play_store"]


def test_expiration_preserves_an_active_stripe_plan(client, engine, monkeypatch):
    _configure(monkeypatch)
    with Session(engine) as session:
        session.add(Subscription(user_id=client.user_id, plan="plus", status="active"))
        session.commit()

    assert _post(
        client,
        _event("evt-premium", product_id=GOOGLE_PREMIUM),
    ).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "premium"

    expired = int((utcnow() - timedelta(seconds=1)).timestamp() * 1000)
    assert _post(
        client,
        _event("evt-expired", "EXPIRATION", product_id=GOOGLE_PREMIUM, expiration_at_ms=expired),
    ).status_code == 200
    with Session(engine) as session:
        assert session.get(User, client.user_id).plan == "plus"


def test_cancellation_keeps_access_until_expiration(client, engine, monkeypatch):
    _configure(monkeypatch)
    response = _post(client, _event("evt-cancel", "CANCELLATION"))
    assert response.status_code == 200
    with Session(engine) as session:
        row = session.exec(select(StoreSubscription)).one()
        assert row.status == "cancelling" and row.will_renew is False
        assert session.get(User, client.user_id).plan == "plus"


def test_unknown_product_and_anonymous_identity_fail_closed(client, engine, monkeypatch):
    _configure(monkeypatch)
    unknown = _post(client, _event("evt-unknown", product_id="someone_elses_product"))
    anonymous = _post(client, _event("evt-anonymous", app_user_id="$RCAnonymousID:abc",
                                    original_app_user_id="$RCAnonymousID:abc"))
    assert unknown.json() == {"received": True, "ignored": True}
    assert anonymous.json() == {"received": True, "ignored": True}
    with Session(engine) as session:
        assert session.exec(select(StoreSubscription)).all() == []
        assert session.get(User, client.user_id).plan == "free"


def test_sandbox_requires_explicit_acceptance(client, monkeypatch):
    _configure(monkeypatch)
    payload = _event("evt-sandbox", environment="SANDBOX")
    assert _post(client, payload).status_code == 400
    _configure(monkeypatch, "PRODUCTION,SANDBOX")
    assert _post(client, payload).status_code == 200


def _apple_event(event_id: str, product_id=APPLE_PLUS, **overrides):
    return _event(
        event_id,
        store="APP_STORE",
        product_id=product_id,
        original_transaction_id=overrides.pop("original_transaction_id", "1000000987654321"),
        **overrides,
    )


def test_apple_purchase_grants_plan_and_status_reports_app_store(client, engine, monkeypatch):
    _configure(monkeypatch)
    response = _post(client, _apple_event("evt-apple-purchase", product_id=APPLE_PREMIUM))
    assert response.json() == {"received": True, "ignored": False}

    with Session(engine) as session:
        rows = session.exec(select(StoreSubscription)).all()
        assert len(rows) == 1
        assert rows[0].store == "APP_STORE" and rows[0].environment == "PRODUCTION"
        assert session.get(User, client.user_id).plan == "premium"
    assert client.get("/api/billing/status").json()["sources"] == ["app_store"]


def test_product_ids_only_count_for_their_own_store(client, engine, monkeypatch):
    """The catalog is keyed by (store, product_id), not product_id alone.

    An Apple identifier arriving on a Play event -- a spoofed or misrouted
    delivery, or a RevenueCat project wired to the wrong app -- must not grant
    anything, and neither must the reverse. This is the pairing that keeps one
    store's catalog from unlocking plans through the other's webhook.
    """
    _configure(monkeypatch)
    apple_id_on_play = _post(client, _event("evt-cross-1", product_id=APPLE_PLUS))
    google_id_on_apple = _post(
        client, _apple_event("evt-cross-2", product_id=GOOGLE_PREMIUM, original_transaction_id="1000000111222333")
    )
    assert apple_id_on_play.json() == {"received": True, "ignored": True}
    assert google_id_on_apple.json() == {"received": True, "ignored": True}
    with Session(engine) as session:
        assert session.exec(select(StoreSubscription)).all() == []
        assert session.get(User, client.user_id).plan == "free"


def test_both_stores_active_keeps_the_highest_plan_and_lists_both_sources(client, engine, monkeypatch):
    _configure(monkeypatch)
    assert _post(client, _event("evt-play-plus")).json()["ignored"] is False
    assert _post(
        client, _apple_event("evt-apple-premium", product_id=APPLE_PREMIUM)
    ).json()["ignored"] is False

    with Session(engine) as session:
        assert len(session.exec(select(StoreSubscription)).all()) == 2
        assert session.get(User, client.user_id).plan == "premium"
    assert client.get("/api/billing/status").json()["sources"] == ["app_store", "play_store"]
