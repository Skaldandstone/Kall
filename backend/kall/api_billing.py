import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.config import get_settings
from kall.db import get_session
from kall.models import BillingEvent, User
from kall.services.billing import (
    apply_subscription_event,
    create_checkout_url,
    create_portal_url,
    get_subscription,
    quota_status,
)
from kall.services.quota import snapshot

router = APIRouter(tags=["billing"])


@router.get("/billing/status")
def billing_status(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    return quota_status(session, user)


@router.post("/billing/checkout")
def checkout(user: User = Depends(get_current_user)):
    return {"url": create_checkout_url(user.id)}


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

    event_id = str(event["id"])
    existing = session.exec(select(BillingEvent).where(BillingEvent.provider_event_id == event_id)).first()
    if existing:
        return {"received": True, "duplicate": True}

    record = BillingEvent(
        provider_event_id=event_id,
        event_type=str(event["type"]),
        payload_json=json.loads(json.dumps(event, default=str)),
    )
    session.add(record)
    session.commit()

    obj = event["data"]["object"]
    metadata = obj.get("metadata", {})
    user_id = metadata.get("kall_user_id") or obj.get("client_reference_id")
    if user_id and event["type"] in {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        apply_subscription_event(session, int(user_id), dict(obj))
    record.status = "processed"
    session.add(record)
    session.commit()
    return {"received": True}


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
