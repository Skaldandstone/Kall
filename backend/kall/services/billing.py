from datetime import datetime

from fastapi import HTTPException
from kall.config import get_settings
from kall.models import ApplicationUsage, Subscription, User
from kall.models.enums import SubscriptionPlan
from sqlmodel import Session, func, select

FREE_APPLICATION_LIMIT = 10
ACTIVE_STATUSES = {"active", "trialing"}

#: How long a paid account keeps its plan after a card first fails, before
#: services/jobs/billing_grace_period.py downgrades it to Free. Someone whose
#: card fails mid-search should not be locked out instantly -- Stripe's own
#: retry schedule runs over roughly two weeks, which is too long to leave a
#: silently-still-paying account (or too long to leave someone locked out if
#: their bank clears it in a day); 72 hours is Kall's own policy on top of
#: that, independent of when or whether Stripe tries the card again.
PAYMENT_GRACE_PERIOD_HOURS = 72


def price_for(plan: str) -> str | None:
    """The Stripe price backing a plan, or None if it is not configured."""
    settings = get_settings()
    return {
        SubscriptionPlan.PLUS: settings.stripe_price_id,
        SubscriptionPlan.PREMIUM: settings.stripe_premium_price_id,
    }.get(plan)


def create_checkout_url(user_id: int, plan: str = SubscriptionPlan.PLUS) -> str:
    settings = get_settings()
    price_id = price_for(plan)
    if not settings.stripe_secret_key or not price_id:
        # Naming the plan matters: with two paid tiers, "Stripe is not
        # configured" alone cannot tell you which price is missing.
        raise HTTPException(status_code=503, detail=f"Stripe is not configured for the {plan} plan")
    import stripe

    stripe.api_key = settings.stripe_secret_key
    metadata = {"kall_user_id": str(user_id), "kall_plan": plan}
    checkout = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{settings.frontend_url}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.frontend_url}/billing",
        client_reference_id=str(user_id),
        metadata=metadata,
        subscription_data={"metadata": metadata},
    )
    return checkout.url


def create_portal_url(customer_id: str) -> str:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    import stripe

    stripe.api_key = settings.stripe_secret_key
    portal = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{settings.frontend_url}/billing",
    )
    return portal.url


def get_subscription(session: Session, user_id: int) -> Subscription:
    item = session.exec(select(Subscription).where(Subscription.user_id == user_id)).first()
    if item:
        return item
    item = Subscription(user_id=user_id)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def completed_usage(session: Session, user_id: int) -> int:
    value = session.exec(
        select(func.coalesce(func.sum(ApplicationUsage.units), 0)).where(
            ApplicationUsage.user_id == user_id,
            ApplicationUsage.event == "application_submitted",
        )
    ).one()
    return int(value or 0)


def quota_status(session: Session, user: User) -> dict:
    subscription = get_subscription(session, user.id)
    used = completed_usage(session, user.id)
    subscribed = subscription.status in ACTIVE_STATUSES and subscription.plan == "plus"
    return {
        "plan": "plus" if subscribed else "free",
        "subscription_status": subscription.status,
        "used": used,
        "free_limit": FREE_APPLICATION_LIMIT,
        "remaining": None if subscribed else max(FREE_APPLICATION_LIMIT - used, 0),
        "allowed": subscribed or used < FREE_APPLICATION_LIMIT,
    }


def assert_submission_allowed(session: Session, user: User) -> None:
    if not quota_status(session, user)["allowed"]:
        raise ValueError("Free application limit reached; upgrade to Kall Plus")


def record_application_submission(session: Session, user_id: int, application_id: int) -> ApplicationUsage:
    existing = session.exec(
        select(ApplicationUsage).where(
            ApplicationUsage.user_id == user_id,
            ApplicationUsage.application_id == application_id,
            ApplicationUsage.event == "application_submitted",
        )
    ).first()
    if existing:
        return existing
    usage = ApplicationUsage(user_id=user_id, application_id=application_id, event="application_submitted")
    session.add(usage)
    session.commit()
    session.refresh(usage)
    return usage


def plan_from_event(payload: dict) -> str:
    """Which plan this subscription is for.

    Prefers the `kall_plan` metadata that create_checkout_url attaches, and
    falls back to matching the price id -- a subscription created before that
    metadata existed will not carry it.
    """
    metadata = payload.get("metadata") or {}
    named = metadata.get("kall_plan")
    if named in {SubscriptionPlan.PLUS, SubscriptionPlan.PREMIUM}:
        return named

    price = payload.get("price") or {}
    price_id = payload.get("price_id") or price.get("id")
    if price_id:
        for plan in (SubscriptionPlan.PLUS, SubscriptionPlan.PREMIUM):
            if price_for(plan) == price_id:
                return plan
    # An active subscription of unknown shape is more likely Plus than nothing,
    # but it must never silently grant the top tier.
    return SubscriptionPlan.PLUS


def apply_subscription_event(session: Session, user_id: int, payload: dict) -> Subscription:
    item = get_subscription(session, user_id)
    item.provider_customer_id = payload.get("customer") or item.provider_customer_id
    item.provider_subscription_id = payload.get("subscription") or payload.get("id") or item.provider_subscription_id
    item.status = str(payload.get("status", item.status))
    # Previously hardcoded to "plus", so buying Premium granted Plus.
    item.plan = plan_from_event(payload) if item.status in ACTIVE_STATUSES else SubscriptionPlan.FREE
    price = payload.get("price") or {}
    item.price_id = payload.get("price_id") or price.get("id") or item.price_id
    period_end = payload.get("current_period_end")
    if period_end:
        item.current_period_end = datetime.utcfromtimestamp(int(period_end))
    item.cancel_at_period_end = bool(payload.get("cancel_at_period_end", False))
    session.add(item)

    # The quota service reads User.plan, not Subscription.plan. Without this
    # a completed purchase changed the billing record and nothing else, so the
    # limits never moved -- the subscription said Plus while the account was
    # still enforced as Free.
    user = session.get(User, user_id)
    if user and user.plan != item.plan:
        user.plan = item.plan
        session.add(user)

    session.commit()
    session.refresh(item)
    return item


def find_subscription_by_customer(session: Session, customer_id: str) -> Subscription | None:
    """Look up a subscription by Stripe customer id.

    Invoice events (payment_failed, paid) do not reliably carry the
    kall_user_id metadata that checkout/subscription events do -- Stripe does
    not copy subscription metadata onto every invoice it generates -- so
    `customer` is the only identifier those events can be trusted to have.
    """
    return session.exec(
        select(Subscription).where(Subscription.provider_customer_id == customer_id)
    ).first()


def apply_payment_failed(session: Session, subscription: Subscription) -> bool:
    """Record a failed invoice. Returns True if this started a new grace window.

    Only the first failure starts the clock -- Stripe retries a failing card
    several times over its own schedule, and a second retry before the first
    grace window has been resolved must not push the deadline back out, or a
    card that keeps failing every 69 hours would never actually get
    downgraded.
    """
    if subscription.payment_failed_at is not None:
        return False
    subscription.payment_failed_at = datetime.utcnow()
    session.add(subscription)
    session.commit()
    return True


def apply_payment_recovered(session: Session, subscription: Subscription) -> bool:
    """Clear a grace window because payment succeeded. Returns True if one was active."""
    if subscription.payment_failed_at is None:
        return False
    subscription.payment_failed_at = None
    session.add(subscription)
    session.commit()
    return True
