"""Kall-only hosted billing with explicit test/live environment isolation."""

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from uuid import uuid4

import stripe
from fastapi import HTTPException
from kall.config import get_settings
from kall.models import Subscription, User
from kall.models.monitoring import MonitoringLease
from kall.services import work_claims
from kall.services.billing import (
    ACTIVE_STATUSES,
    apply_subscription_event,
    catalog,
    get_subscription,
    object_id,
    price_for,
    subscription_item,
)
from sqlalchemy import update
from sqlmodel import Session, select

STRIPE_API_VERSION = "2026-08-26.dahlia"
TERMINAL_SUBSCRIPTIONS = {"canceled", "incomplete_expired"}


def validate_key_environment() -> None:
    settings = get_settings()
    prefixes = ("rk_live_", "sk_live_") if settings.stripe_livemode else ("rk_test_", "sk_test_")
    if not (settings.stripe_secret_key or "").startswith(prefixes):
        raise HTTPException(503, "Stripe key environment does not match")


def expected_livemode() -> bool:
    return get_settings().stripe_livemode


def require_configuration() -> None:
    settings = get_settings()
    if not settings.stripe_enabled:
        raise HTTPException(503, "Payments are not switched on yet")
    validate_key_environment()
    scope = settings.stripe_billing_scope or ""
    if not scope.startswith("kall:") or len(scope) < 6 or len(scope) > 80:
        raise HTTPException(503, "Kall billing scope is not configured")
    if not settings.stripe_webhook_secret or len(catalog()) != 2:
        raise HTTPException(503, "Kall billing catalog or webhook is not configured")


def stripe_client():
    require_configuration()
    return stripe.StripeClient(get_settings().stripe_secret_key, stripe_version=STRIPE_API_VERSION,
                               max_network_retries=1, http_client=stripe.RequestsClient(timeout=10))


def provider_call(method, *args, **kwargs) -> dict:
    try:
        value = method(*args, **kwargs)
        return value.to_dict() if isinstance(value, stripe.StripeObject) else dict(value)
    except stripe.StripeError:
        # Provider messages can contain configuration or customer details.
        raise HTTPException(503, "Billing provider is unavailable; please retry") from None


@contextmanager
def billing_transaction(session: Session, user_id: int):
    """Serialize customer, Checkout and webhook work, with a fencing write."""
    key = f"billing:{get_settings().stripe_billing_scope}:{user_id}"
    token = work_claims.acquire(session, key, datetime.utcnow(), user_id=user_id)
    if not token:
        raise HTTPException(503, "Billing update is already in progress; please retry")

    def commit():
        fenced = session.execute(update(MonitoringLease).where(
            MonitoringLease.key == key, MonitoringLease.token == token,
            MonitoringLease.expires_at > datetime.utcnow(),
        ).values(token=token))
        if fenced.rowcount != 1:
            raise HTTPException(503, "Billing update lease expired; please retry")
        session.commit()

    try:
        yield commit
        commit()
    except Exception:
        session.rollback()
        raise
    finally:
        work_claims.release(session, key, token)


def metadata_for(row: Subscription) -> dict[str, str]:
    return {"kall_user_id": str(row.user_id), "kall_billing_scope": row.billing_scope,
            "kall_binding": row.billing_binding_key}


def owns_object(row: Subscription, value: dict) -> bool:
    metadata = value.get("metadata") or {}
    return bool(row.billing_binding_key and value.get("livemode") is expected_livemode()
                and all(metadata.get(key) == expected for key, expected in metadata_for(row).items()))


def safe_url(value: str | None, host: str) -> str:
    try:
        parsed = urlsplit(value or "")
        valid = parsed.scheme == "https" and parsed.hostname == host and not (parsed.username or parsed.password or parsed.port)
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise HTTPException(503, "Billing provider returned an invalid redirect")
    return value


def frontend_url() -> str:
    value = get_settings().frontend_url.rstrip("/")
    parsed = urlsplit(value)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "[::1]", "::1"}
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not (parsed.scheme == "https" or local_http):
        raise HTTPException(503, "Billing return URL is not configured safely")
    return value


def bound_row(session: Session, user_id: int) -> Subscription:
    row = get_subscription(session, user_id, commit=False)
    scope = get_settings().stripe_billing_scope
    livemode = expected_livemode()
    if row.billing_scope and (row.billing_scope != scope or row.provider_livemode is not livemode):
        raise HTTPException(503, "Billing customer belongs to a different environment")
    if row.provider_customer_id and (not row.billing_scope or not row.billing_binding_key):
        raise HTTPException(503, "Existing billing customer requires owner reconciliation")
    if not row.billing_binding_key:
        row.billing_scope, row.provider_livemode = scope, livemode
        row.billing_binding_key = uuid4().hex
        row.billing_binding_created_at = datetime.utcnow()
        session.add(row)
    return row


def checked_customer(client, row: Subscription) -> dict:
    customer = provider_call(client.v1.customers.retrieve, row.provider_customer_id)
    if customer.get("deleted") or customer.get("id") != row.provider_customer_id or not owns_object(row, customer):
        raise HTTPException(503, "Billing customer ownership could not be verified")
    return customer


def checked_portal_configuration(client) -> str:
    configuration_id = get_settings().stripe_portal_configuration_id
    if not configuration_id:
        raise HTTPException(503, "Kall customer portal is not configured")
    configuration = provider_call(client.v1.billing_portal.configurations.retrieve, configuration_id)
    if (configuration.get("id") != configuration_id or not configuration.get("active")
            or configuration.get("livemode") is not expected_livemode()):
        raise HTTPException(503, "Kall customer portal configuration is unavailable")
    # A shared default portal must never advertise another product's plans.
    updates = (configuration.get("features") or {}).get("subscription_update") or {}
    if updates.get("enabled"):
        products = updates.get("products") or []
        allowed = catalog()
        if not products or any(not item.get("prices") or any(
                price not in allowed or allowed[price][1] != item.get("product") for price in item["prices"]
        ) for item in products):
            raise HTTPException(503, "Customer portal includes unapproved products or prices")
    return configuration_id


def checked_subscription(client, row: Subscription, subscription_id: str) -> dict | None:
    current = provider_call(client.v1.subscriptions.retrieve, subscription_id, {"expand": ["latest_invoice"]})
    if current.get("id") != subscription_id or object_id(current.get("customer")) != row.provider_customer_id or not owns_object(row, current):
        return None
    return current


def create_checkout_url(session: Session, user: User, plan: str) -> str:
    require_configuration()
    if not user.is_active:
        raise HTTPException(403, "This account is not active")
    price_id = price_for(plan)
    if price_id not in catalog():
        raise HTTPException(503, f"Stripe is not configured for the {plan} plan")
    base = frontend_url()
    client = stripe_client()
    with billing_transaction(session, user.id) as commit:
        row = bound_row(session, user.id)
        checked_portal_configuration(client)
        price = provider_call(client.v1.prices.retrieve, price_id)
        recurring = price.get("recurring") or {}
        if (price.get("id") != price_id or price.get("livemode") is not expected_livemode() or not price.get("active")
                or object_id(price.get("product")) != catalog()[price_id][1]
                or recurring.get("interval") != "month" or recurring.get("interval_count") != 1):
            raise HTTPException(503, "Kall recurring price configuration could not be verified")
        if row.provider_customer_id:
            checked_customer(client, row)
        else:
            if datetime.utcnow() - row.billing_binding_created_at > timedelta(hours=23):
                raise HTTPException(503, "Unresolved customer creation requires owner reconciliation")
            commit()  # Persist the binding before the external idempotent operation.
            customer = provider_call(client.v1.customers.create, {"metadata": metadata_for(row)},
                                     {"idempotency_key": f"kall-customer-{row.billing_binding_key}"})
            if not owns_object(row, customer) or not str(customer.get("id", "")).startswith("cus_"):
                raise HTTPException(503, "Billing customer ownership could not be verified")
            row.provider_customer_id = customer["id"]
            session.add(row)
            commit()
        terminal_subscription_id = None
        if row.provider_subscription_id:
            current = checked_subscription(client, row, row.provider_subscription_id)
            if current is None:
                raise HTTPException(503, "Existing subscription ownership could not be verified")
            if current.get("status") not in TERMINAL_SUBSCRIPTIONS:
                raise HTTPException(409, "Use Manage billing for the existing subscription")
            terminal_subscription_id = current["id"]
        if row.checkout_session_id:
            checkout = provider_call(client.v1.checkout.sessions.retrieve, row.checkout_session_id)
            if object_id(checkout.get("customer")) != row.provider_customer_id or not owns_object(row, checkout):
                raise HTTPException(503, "Existing Checkout ownership could not be verified")
            if checkout.get("status") == "open":
                if row.checkout_plan != plan:
                    raise HTTPException(409, "Finish or expire the existing Checkout before choosing another plan")
                return safe_url(checkout.get("url"), "checkout.stripe.com")
            completed_terminal = (checkout.get("status") == "complete" and terminal_subscription_id
                                  and object_id(checkout.get("subscription")) == terminal_subscription_id)
            if checkout.get("status") != "expired" and not completed_terminal:
                raise HTTPException(409, "Checkout is already complete; wait for subscription confirmation")
            row.checkout_attempt_key = row.checkout_session_id = row.checkout_plan = None
            row.checkout_expires_at = None
        if not row.checkout_attempt_key:
            row.checkout_attempt_key, row.checkout_plan = uuid4().hex, plan
            row.checkout_expires_at = datetime.utcnow() + timedelta(hours=1)
            session.add(row)
            commit()
        if row.checkout_plan != plan or row.checkout_expires_at <= datetime.utcnow():
            raise HTTPException(409, "Unresolved Checkout requires reconciliation before another attempt")
        metadata = {**metadata_for(row), "kall_plan": plan}
        tag = "kall_" + "".join(chr(97 + int(char, 16)) for char in row.checkout_attempt_key[-8:])
        checkout = provider_call(client.v1.checkout.sessions.create, {
            "mode": "subscription", "customer": row.provider_customer_id,
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": f"{base}/billing?checkout=returned",
            "cancel_url": f"{base}/billing", "client_reference_id": str(user.id),
            "metadata": metadata, "subscription_data": {"metadata": metadata},
            "expires_at": int(row.checkout_expires_at.replace(tzinfo=UTC).timestamp()),
            "integration_identifier": tag, "automatic_tax": {"enabled": False},
        }, {"idempotency_key": f"kall-checkout-{row.checkout_attempt_key}"})
        checkout_prefix = "cs_live_" if expected_livemode() else "cs_test_"
        if (not owns_object(row, checkout) or object_id(checkout.get("customer")) != row.provider_customer_id
                or not str(checkout.get("id", "")).startswith(checkout_prefix)):
            raise HTTPException(503, "Checkout ownership could not be verified")
        row.checkout_session_id = checkout["id"]
        session.add(row)
        return safe_url(checkout.get("url"), "checkout.stripe.com")


def create_portal_url(session: Session, user: User, target_plan: str | None = None) -> str:
    """Open the Stripe customer portal, optionally straight into a prorated plan change.

    Changing a live subscription's price (rather than starting a new one) is
    the only way Stripe prorates the switch, and the portal configuration
    already has `proration_behavior: create_prorations` set for exactly this.
    Deep-linking into `subscription_update_confirm` with the target price
    puts that prorated amount in front of the user in one step, instead of
    dropping them on the portal's home screen to find the plan switch
    themselves.
    """
    require_configuration()
    if not user.is_active:
        raise HTTPException(403, "This account is not active")
    client = stripe_client()
    base = frontend_url()
    with billing_transaction(session, user.id):
        row = session.exec(select(Subscription).where(Subscription.user_id == user.id)).first()
        if row is None or not row.provider_customer_id:
            raise HTTPException(422, "No Stripe customer is associated with this account")
        row = bound_row(session, user.id)
        checked_customer(client, row)
        configuration_id = checked_portal_configuration(client)
        params = {"customer": row.provider_customer_id, "return_url": f"{base}/billing",
                  "configuration": configuration_id}
        if target_plan is not None:
            params["flow_data"] = _upgrade_flow_data(client, row, target_plan)
        portal = provider_call(client.v1.billing_portal.sessions.create, params)
        return safe_url(portal.get("url"), "billing.stripe.com")


def _upgrade_flow_data(client, row: Subscription, target_plan: str) -> dict:
    target_price = price_for(target_plan)
    if target_price not in catalog():
        raise HTTPException(503, f"Stripe is not configured for the {target_plan} plan")
    if not row.provider_subscription_id:
        raise HTTPException(422, "There is no active subscription to change")
    current = checked_subscription(client, row, row.provider_subscription_id)
    if current is None:
        raise HTTPException(503, "Existing subscription ownership could not be verified")
    if current.get("status") not in ACTIVE_STATUSES:
        raise HTTPException(409, "Use Manage billing for the existing subscription")
    item = subscription_item(current)
    if item is None:
        raise HTTPException(503, "Kall subscription item configuration could not be verified")
    if object_id(item.get("price")) == target_price:
        raise HTTPException(409, "That is already the current plan")
    return {
        "type": "subscription_update_confirm",
        "subscription_update_confirm": {
            "subscription": current["id"],
            "items": [{"id": item["id"], "price": target_price, "quantity": 1}],
        },
    }


def invoice_subscription_id(invoice: dict) -> str | None:
    parent = invoice.get("parent") or {}
    details = parent.get("subscription_details") or {}
    return object_id(details.get("subscription")) or object_id(invoice.get("subscription"))


def event_subscription_id(event: dict) -> str | None:
    obj = event["data"]["object"]
    if event["type"].startswith("customer.subscription."):
        return object_id(obj)
    if event["type"] in {"invoice.paid", "invoice.payment_failed"}:
        return invoice_subscription_id(obj)
    return None


def event_owner(session: Session, event: dict) -> Subscription | None:
    if not event_subscription_id(event):
        return None
    customer_id = object_id(event["data"]["object"].get("customer"))
    if not customer_id:
        return None
    return session.exec(select(Subscription).where(
        Subscription.provider_customer_id == customer_id,
        Subscription.billing_scope == get_settings().stripe_billing_scope,
        Subscription.provider_livemode.is_(expected_livemode()), Subscription.billing_binding_key.is_not(None),
    )).first()


def reconcile_event(session: Session, event: dict) -> bool:
    """Retrieve current state while serialized. Event timestamps are not order."""
    row = event_owner(session, event)
    if row is None:
        return False
    client = stripe_client()
    subscription_id = event_subscription_id(event)
    current = checked_subscription(client, row, subscription_id)
    if current is None:
        return False
    if row.provider_subscription_id and row.provider_subscription_id != subscription_id:
        previous = checked_subscription(client, row, row.provider_subscription_id)
        if previous is None or previous.get("status") not in TERMINAL_SUBSCRIPTIONS:
            return False
        # An old terminal event must never overwrite a newer subscription.
        if current.get("status") in TERMINAL_SUBSCRIPTIONS:
            return False
    if event["type"].startswith("invoice."):
        latest = current.get("latest_invoice")
        if object_id(latest) != event["data"]["object"].get("id"):
            return False
    apply_subscription_event(session, row.user_id, current, commit=False)
    return True


def cancel_at_period_end(session: Session, user_id: int) -> str | None:
    """Stop `user_id`'s subscription renewing, leaving paid access to run out.

    Period end rather than immediate cancellation, because /terms section 9
    already promises that cancelling stops the next renewal and that paid
    access runs out the period already paid for. The money outcome is the
    same either way -- Stripe's immediate cancel does not refund by default
    -- but this is the one that matches the published sentence, and the Terms
    should not have to change to accommodate the implementation. Nothing here
    prorates or refunds, for the same reason.

    Returns the subscription id it cancelled, or None when there was nothing
    to cancel: no billing row, no subscription on it, billing switched off, or
    a subscription already terminal or already set to cancel. Raises rather
    than guessing if ownership cannot be verified -- cancelling a subscription
    that is not ours is worse than not cancelling at all.
    """
    if not get_settings().stripe_enabled:
        return None
    row = session.exec(select(Subscription).where(Subscription.user_id == user_id)).first()
    if row is None or not row.provider_customer_id or not row.provider_subscription_id:
        return None

    client = stripe_client()
    subscription_id = row.provider_subscription_id
    current = checked_subscription(client, row, subscription_id)
    if current is None:
        raise HTTPException(503, "Subscription ownership could not be verified")
    if current.get("status") in TERMINAL_SUBSCRIPTIONS or current.get("cancel_at_period_end"):
        return None

    updated = provider_call(client.v1.subscriptions.update, subscription_id,
                            {"cancel_at_period_end": True},
                            {"idempotency_key": f"kall-cancel-{row.billing_binding_key}"})
    if updated.get("id") != subscription_id or not updated.get("cancel_at_period_end"):
        raise HTTPException(503, "Subscription cancellation could not be confirmed")
    return subscription_id
