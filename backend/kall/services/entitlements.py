from __future__ import annotations

from datetime import datetime

from kall.clock import utcnow
from kall.models import StoreSubscription, Subscription, User
from kall.models.enums import SubscriptionPlan
from sqlmodel import Session, select

PLAN_RANK = {
    SubscriptionPlan.FREE: 0,
    SubscriptionPlan.PLUS: 1,
    SubscriptionPlan.PREMIUM: 2,
}
ACTIVE_STORE_STATUSES = {"active", "cancelling", "billing_issue"}


def store_subscription_is_active(item: StoreSubscription, now: datetime | None = None) -> bool:
    now = now or utcnow()
    return (
        item.status in ACTIVE_STORE_STATUSES
        and item.plan in {SubscriptionPlan.PLUS, SubscriptionPlan.PREMIUM}
        and item.active_until is not None
        and item.active_until > now
    )


def effective_plan(session: Session, user_id: int, now: datetime | None = None) -> str:
    now = now or utcnow()
    plans: list[str] = []
    stripe = session.exec(select(Subscription).where(Subscription.user_id == user_id)).first()
    if stripe and stripe.plan in PLAN_RANK:
        plans.append(stripe.plan)
    stores = session.exec(
        select(StoreSubscription).where(StoreSubscription.user_id == user_id)
    ).all()
    plans.extend(item.plan for item in stores if store_subscription_is_active(item, now))
    return max(plans or [SubscriptionPlan.FREE], key=lambda plan: PLAN_RANK.get(plan, 0))


def sync_user_plan(session: Session, user_id: int, now: datetime | None = None) -> str:
    plan = effective_plan(session, user_id, now)
    user = session.get(User, user_id)
    if user and user.plan != plan:
        user.plan = plan
        session.add(user)
        session.flush()
    return plan


def active_sources(session: Session, user_id: int, now: datetime | None = None) -> list[str]:
    now = now or utcnow()
    sources: list[str] = []
    stripe = session.exec(select(Subscription).where(Subscription.user_id == user_id)).first()
    if stripe and stripe.plan in {SubscriptionPlan.PLUS, SubscriptionPlan.PREMIUM}:
        sources.append("stripe")
    stores = session.exec(
        select(StoreSubscription).where(StoreSubscription.user_id == user_id)
    ).all()
    sources.extend(sorted({item.store.lower() for item in stores if store_subscription_is_active(item, now)}))
    return sources
