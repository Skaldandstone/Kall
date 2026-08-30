import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.config import get_settings
from kall.db import get_session
from kall.models import BillingEvent, User
from kall.models.enums import SubscriptionPlan
from kall.services.billing import (
    apply_payment_failed,
    apply_payment_recovered,
    apply_subscription_event,
    create_checkout_url,
    create_portal_url,
    find_subscription_by_customer,
    get_subscription,
)
from kall.services.quota import snapshot

router = APIRouter(tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: str = SubscriptionPlan.PLUS


@router.post("/billing/checkout")
def checkout(payload: CheckoutRequest | None = None, user: User = Depends(get_current_user)):
    plan = (payload or CheckoutRequest()).plan
    if plan not in {SubscriptionPlan.PLUS, SubscriptionPlan.PREMIUM}:
        raise HTTPException(422, "That plan cannot be purchased")
    return {"url": create_checkout_url(user.id, plan)}


@router.post("/billing/portal")
def portal(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    subscription = get_subscription(session, user.id)
    if not subscription.provider_customer_id:
        raise HTTPException(422, "No Stripe customer is associated with this account")
    return {"url": create_portal_url(subscription.provider_customer_id)}


@router.post("/billing/webhook")
async def webhook(request: Request, session: Session = Depends(get_session)):
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Stripe webhook is not configured")
    try:
        import stripe

        payload = await request.body()
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=request.headers.get("stripe-signature", ""),
            secret=settings.stripe_webhook_secret,
        )
    except Exception as exc:
        raise HTTPException(400, "Invalid Stripe webhook") from exc

    if bool(event.get("livemode", False)) != settings.stripe_livemode:
        raise HTTPException(400, "Stripe webhook environment does not match")

    event_id = str(event["id"])
    try:
        # Pending records from older releases must be retried. Lock them so
        # two retries cannot both apply a grant; new events use the unique ID.
        record = session.exec(
            select(BillingEvent)
            .where(BillingEvent.provider_event_id == event_id)
            .with_for_update()
        ).first()
        if record and record.status == "processed":
            return {"received": True, "duplicate": True}
        if record is None:
            record = BillingEvent(
                provider_event_id=event_id,
                event_type=str(event["type"]),
                payload_json=json.loads(json.dumps(event, default=str)),
            )
            session.add(record)
            session.flush()

        _apply_event(session, event)
        record.status = "processed"
        record.processed_at = datetime.utcnow()
        record.error = None
        session.add(record)
        # The receipt and entitlement changes succeed or roll back together.
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.exec(
            select(BillingEvent).where(BillingEvent.provider_event_id == event_id)
        ).first()
        if existing and existing.status == "processed":
            return {"received": True, "duplicate": True}
        raise
    except Exception:
        session.rollback()
        raise
    return {"received": True}


def _apply_event(session: Session, event: dict) -> None:
    obj = event["data"]["object"]
    metadata = obj.get("metadata") or {}
    # A generic client_reference_id can belong to another app in this account.
    user_id = metadata.get("kall_user_id")
    if user_id and event["type"] in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        # Checkout's status is "complete", not a subscription status. Using
        # it here could undo an earlier subscription.created entitlement.
        apply_subscription_event(session, int(user_id), dict(obj), commit=False)
    elif event["type"] in {"invoice.payment_failed", "invoice.paid"}:
        # Invoices do not reliably carry kall_user_id metadata, so these are
        # looked up by Stripe customer id instead -- see
        # find_subscription_by_customer.
        customer_id = obj.get("customer")
        subscription = find_subscription_by_customer(session, customer_id) if customer_id else None
        if subscription:
            if event["type"] == "invoice.payment_failed":
                apply_payment_failed(session, subscription, commit=False)
            else:
                apply_payment_recovered(session, subscription, commit=False)


@router.get("/me/usage")
def get_usage(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    """What this account has used, and what its plan allows.

    Exists so the product can show a limit approaching rather than only
    reporting one that has already been hit.
    """
    return snapshot(session, current_user)
