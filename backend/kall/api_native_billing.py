"""RevenueCat webhook intake for Apple and Google subscription entitlements."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from kall.clock import utcfromtimestamp, utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models import BillingEvent, StoreSubscription, User
from kall.models.enums import SubscriptionPlan
from kall.services.entitlements import sync_user_plan

router = APIRouter(tags=["billing"])
MAX_WEBHOOK_BYTES = 512 * 1024
SIGNATURE_TOLERANCE_SECONDS = 300
ACTIVE_EVENTS = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "SUBSCRIPTION_EXTENDED",
    "REFUND_REVERSED",
}
SUPPORTED_EVENTS = ACTIVE_EVENTS | {
    "CANCELLATION",
    "BILLING_ISSUE",
    "EXPIRATION",
    "TRANSFER",
    "PRODUCT_CHANGE",
}


def _fail_closed(message: str = "Invalid RevenueCat webhook") -> HTTPException:
    return HTTPException(400, message)


def _verify_request(request: Request, body: bytes) -> None:
    settings = get_settings()
    if not settings.revenuecat_enabled:
        raise HTTPException(404, "Not found")
    expected_authorization = settings.revenuecat_webhook_authorization or ""
    received_authorization = request.headers.get("authorization", "")
    if not expected_authorization or not hmac.compare_digest(
        received_authorization, expected_authorization
    ):
        raise _fail_closed()

    header = request.headers.get("x-revenuecat-webhook-signature", "")
    fields = {}
    for value in header.split(","):
        name, separator, content = value.strip().partition("=")
        if separator and name in {"t", "v1"}:
            fields[name] = content
    try:
        timestamp = int(fields["t"])
    except (KeyError, ValueError):
        raise _fail_closed() from None
    if abs(int(time.time()) - timestamp) > SIGNATURE_TOLERANCE_SECONDS:
        raise _fail_closed()
    signed = str(timestamp).encode() + b"." + body
    expected_signature = hmac.new(
        (settings.revenuecat_webhook_signing_secret or "").encode(),
        signed,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(fields.get("v1", ""), expected_signature):
        raise _fail_closed()


def _event_payload(body: bytes) -> dict:
    try:
        payload = json.loads(body)
        event = payload["event"]
        if payload.get("api_version") != "1.0" or not isinstance(event, dict):
            raise ValueError
        if not isinstance(event.get("id"), str) or not 1 <= len(event["id"]) <= 255:
            raise ValueError
        if not isinstance(event.get("type"), str):
            raise ValueError
        if not isinstance(event.get("event_timestamp_ms"), int):
            raise ValueError
        return event
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        raise _fail_closed() from None


def _accepted_environment(event: dict) -> bool:
    accepted = {
        value.strip().upper()
        for value in get_settings().revenuecat_accepted_environments.split(",")
        if value.strip()
    }
    return event.get("environment") in accepted


def _candidate_user_ids(event: dict, *fields: str) -> set[str]:
    candidates: set[str] = set()
    for field in fields:
        value = event.get(field)
        values = value if isinstance(value, list) else [value]
        for candidate in values:
            if isinstance(candidate, str) and candidate.startswith("user_") and len(candidate) <= 255:
                candidates.add(candidate)
    return candidates


def _resolve_one_user(session: Session, event: dict) -> User | None:
    candidates = _candidate_user_ids(event, "app_user_id", "original_app_user_id", "aliases")
    if not candidates:
        return None
    users = session.exec(select(User).where(User.clerk_user_id.in_(candidates))).all()  # type: ignore[union-attr]
    if len(users) > 1:
        raise _fail_closed("RevenueCat identity maps to multiple accounts")
    return users[0] if users else None


def _plan_for(event: dict) -> str:
    settings = get_settings()
    product_id = event.get("product_id")
    catalog = {
        ("PLAY_STORE", settings.revenuecat_google_plus_product_id): SubscriptionPlan.PLUS,
        ("PLAY_STORE", settings.revenuecat_google_premium_product_id): SubscriptionPlan.PREMIUM,
        ("APP_STORE", settings.revenuecat_apple_plus_product_id): SubscriptionPlan.PLUS,
        ("APP_STORE", settings.revenuecat_apple_premium_product_id): SubscriptionPlan.PREMIUM,
    }
    return catalog.get((event.get("store"), product_id), SubscriptionPlan.FREE)


def _event_time(event: dict) -> datetime:
    return utcfromtimestamp(event["event_timestamp_ms"] / 1000)


def _expiration(event: dict) -> datetime | None:
    value = event.get("expiration_at_ms")
    return utcfromtimestamp(value / 1000) if isinstance(value, int) and value > 0 else None


def _apply_transfer(session: Session, event: dict) -> set[int]:
    affected: set[int] = set()
    source_ids = _candidate_user_ids(event, "transferred_from")
    if not source_ids:
        return affected
    users = session.exec(select(User).where(User.clerk_user_id.in_(source_ids))).all()  # type: ignore[union-attr]
    event_at = _event_time(event)
    for user in users:
        rows = session.exec(
            select(StoreSubscription).where(StoreSubscription.user_id == user.id)
        ).all()
        for row in rows:
            if event_at >= row.last_event_at:
                row.status = "transferred"
                row.will_renew = False
                row.last_event_at = event_at
                row.last_provider_event_id = event["id"]
                session.add(row)
                affected.add(user.id)
    return affected


def _apply_subscription(session: Session, event: dict, user: User) -> bool:
    event_type = event["type"]
    if event_type == "PRODUCT_CHANGE":
        # Store changes can be immediate or deferred. The following renewal is
        # the authoritative point at which access to the new product begins.
        return False
    transaction_id = event.get("original_transaction_id")
    product_id = event.get("product_id")
    store = event.get("store")
    if not all(isinstance(value, str) and 1 <= len(value) <= 255 for value in (
        transaction_id,
        product_id,
        store,
    )):
        raise _fail_closed()
    if store not in {"PLAY_STORE", "APP_STORE"}:
        return False
    plan = _plan_for(event)
    if plan == SubscriptionPlan.FREE:
        return False
    expiration = _expiration(event)
    if expiration is None:
        raise _fail_closed()

    event_at = _event_time(event)
    row = session.exec(
        select(StoreSubscription).where(
            StoreSubscription.provider == "revenuecat",
            StoreSubscription.original_transaction_id == transaction_id,
        ).with_for_update()
    ).first()
    if row and event_at < row.last_event_at:
        return False
    if row is None:
        row = StoreSubscription(
            user_id=user.id,
            store=store,
            environment=event["environment"],
            original_transaction_id=transaction_id,
            product_id=product_id,
            plan=plan,
            last_event_at=event_at,
            last_provider_event_id=event["id"],
        )
    row.user_id = user.id
    row.store = store
    row.environment = event["environment"]
    row.product_id = product_id
    row.plan = plan
    row.active_until = expiration
    row.last_event_at = event_at
    row.last_provider_event_id = event["id"]
    if event_type in ACTIVE_EVENTS:
        row.status = "active"
        row.will_renew = True
    elif event_type == "CANCELLATION":
        row.status = "cancelling"
        row.will_renew = False
    elif event_type == "BILLING_ISSUE":
        row.status = "billing_issue"
    elif event_type == "EXPIRATION":
        row.status = "expired"
        row.will_renew = False
    session.add(row)
    session.flush()
    sync_user_plan(session, user.id)
    return True


@router.post("/billing/revenuecat/webhook")
async def revenuecat_webhook(request: Request, session: Session = Depends(get_session)) -> dict:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_WEBHOOK_BYTES:
            raise HTTPException(413, "RevenueCat webhook is too large")
    raw_body = bytes(body)
    _verify_request(request, raw_body)
    event = _event_payload(raw_body)
    if event["type"] not in SUPPORTED_EVENTS:
        return {"received": True, "ignored": True}
    if not _accepted_environment(event):
        raise _fail_closed("RevenueCat webhook environment does not match")

    event_id = f"revenuecat:{event['id']}"
    existing = session.exec(
        select(BillingEvent).where(BillingEvent.provider_event_id == event_id)
    ).first()
    if existing and existing.status == "processed":
        return {"received": True, "duplicate": True}

    user = None if event["type"] == "TRANSFER" else _resolve_one_user(session, event)
    if event["type"] != "TRANSFER" and user is None:
        return {"received": True, "ignored": True}
    try:
        record = existing or BillingEvent(
            provider="revenuecat",
            provider_event_id=event_id,
            event_type=event["type"],
        )
        session.add(record)
        if event["type"] == "TRANSFER":
            affected = _apply_transfer(session, event)
            for user_id in affected:
                sync_user_plan(session, user_id)
            applied = bool(affected)
        else:
            applied = _apply_subscription(session, event, user)
        record.payload_json = {
            "id": event_id,
            "type": event["type"],
            "store": event.get("store"),
            "environment": event.get("environment"),
            "applied": applied,
        }
        record.status = "processed"
        record.processed_at = utcnow()
        record.error = None
        session.add(record)
        session.commit()
    except IntegrityError:
        session.rollback()
        duplicate = session.exec(
            select(BillingEvent).where(BillingEvent.provider_event_id == event_id)
        ).first()
        if duplicate and duplicate.status == "processed":
            return {"received": True, "duplicate": True}
        raise
    return {"received": True, "ignored": not applied}
