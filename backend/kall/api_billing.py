"""Authenticated billing entry points and raw-body Stripe webhook verification."""


import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from kall.auth import get_current_user
from kall.clock import utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models import BillingEvent, Subscription, User
from kall.models.enums import SubscriptionPlan
from kall.services.entitlements import active_sources
from kall.services.quota import snapshot
from kall.services.stripe_billing import (
    billing_transaction,
    create_checkout_url,
    create_portal_url,
    event_owner,
    event_subscription_id,
    expected_livemode,
    reconcile_event,
    require_configuration,
)

router = APIRouter(tags=["billing"])
SUPPORTED_EVENTS = {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
                    "invoice.paid", "invoice.payment_failed"}


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: str = SubscriptionPlan.PLUS


@router.get("/billing/status")
def billing_status(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    enabled = user.is_active
    try:
        require_configuration()
    except HTTPException:
        enabled = False
    row = session.exec(select(Subscription).where(Subscription.user_id == user.id)).first()
    bound = bool(row and row.provider_customer_id and row.billing_binding_key
                 and row.billing_scope == get_settings().stripe_billing_scope
                 and row.provider_livemode is expected_livemode())
    # No provider identity, binding token, or key crosses the browser boundary.
    return {
        "enabled": enabled,
        "can_manage": enabled and bound,
        "livemode": enabled and expected_livemode(),
        "native_enabled": user.is_active and get_settings().revenuecat_enabled,
        "plan": str(user.plan),
        "sources": active_sources(session, user.id),
    }


@router.post("/billing/checkout")
def checkout(payload: CheckoutRequest | None = None, user: User = Depends(get_current_user),
             session: Session = Depends(get_session)):
    plan = (payload or CheckoutRequest()).plan
    if plan not in {SubscriptionPlan.PLUS, SubscriptionPlan.PREMIUM}:
        raise HTTPException(422, "That plan cannot be purchased")
    return {"url": create_checkout_url(session, user, plan)}


@router.post("/billing/portal")
def portal(payload: CheckoutRequest | None = None, user: User = Depends(get_current_user),
           session: Session = Depends(get_session)):
    target_plan = payload.plan if payload is not None else None
    if target_plan is not None and target_plan not in {SubscriptionPlan.PLUS, SubscriptionPlan.PREMIUM}:
        raise HTTPException(422, "That plan cannot be selected")
    return {"url": create_portal_url(session, user, target_plan)}


@router.post("/billing/webhook")
async def webhook(request: Request, session: Session = Depends(get_session)):
    require_configuration()
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 512 * 1024:
            raise HTTPException(413, "Stripe webhook is too large")
    try:
        event = stripe.Webhook.construct_event(payload=bytes(body),
            sig_header=request.headers.get("stripe-signature", ""), secret=get_settings().stripe_webhook_secret)
        if isinstance(event, stripe.StripeObject):
            event = event.to_dict()
        if not isinstance(event.get("id"), str) or not event["id"].startswith("evt_") or len(event["id"]) > 255:
            raise ValueError("Invalid event identity")
        if not isinstance(event["type"], str) or not isinstance(event["data"]["object"], dict):
            raise ValueError("Invalid event shape")
    except (ValueError, KeyError, TypeError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Invalid Stripe webhook") from None
    if event.get("livemode") is not expected_livemode() or event.get("account"):
        raise HTTPException(400, "Stripe webhook environment does not match")
    if event["type"] not in SUPPORTED_EVENTS:
        return {"received": True, "ignored": True}
    # Stripe and SQLAlchemy are synchronous. Do not block the ASGI event loop
    # while reconciling a provider response or waiting for a database lock.
    return await run_in_threadpool(_process_webhook_event, session, event)


def _process_webhook_event(session: Session, event: dict):
    row = event_owner(session, event)
    if row is None:
        return {"received": True, "ignored": True}
    event_id = event["id"]
    try:
        with billing_transaction(session, row.user_id):
            record = session.exec(select(BillingEvent).where(
                BillingEvent.provider_event_id == event_id,
            ).with_for_update()).first()
            if record and record.status == "processed":
                return {"received": True, "duplicate": True}
            if record is None:
                record = BillingEvent(provider_event_id=event_id, event_type=event["type"])
                session.add(record)
                session.flush()
            applied = _apply_event(session, event)
            # Retain reconciliation references, never invoice addresses or the
            # whole provider payload. No signature or secret is persisted.
            record.payload_json = {"id": event_id, "type": event["type"], "livemode": expected_livemode(),
                                   "object_id": event["data"]["object"].get("id"),
                                   "subscription_id": event_subscription_id(event), "applied": bool(applied)}
            record.status, record.processed_at, record.error = "processed", utcnow(), None
            session.add(record)
    except IntegrityError:
        session.rollback()
        existing = session.exec(select(BillingEvent).where(BillingEvent.provider_event_id == event_id)).first()
        if existing and existing.status == "processed":
            return {"received": True, "duplicate": True}
        raise
    return {"received": True, "ignored": not applied}


def _apply_event(session: Session, event: dict) -> bool:
    return reconcile_event(session, event)


@router.get("/me/usage")
def get_usage(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict:
    return snapshot(session, current_user)
