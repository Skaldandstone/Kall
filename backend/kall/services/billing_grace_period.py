"""Downgrade accounts whose payment has been failing past the grace period.

`services/billing.py`'s `apply_payment_failed` starts a clock
(`Subscription.payment_failed_at`) the first time a card fails; this is what
actually enforces the deadline. Stripe's own retry schedule runs over roughly
two weeks and is not something Kall controls -- this is Kall's own 72-hour
policy layered independently on top of it, so someone stays on their paid
plan for up to three days after a card first fails regardless of when or
whether Stripe tries it again in that window.

Downgrading writes both `Subscription.plan` and `User.plan` deliberately:
apply_subscription_event's webhook path had a bug earlier this session where
it only wrote the former, and the quota service reads the latter -- see that
fix's commit for the failure mode this is guarding against happening again.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from kall.models import Subscription, User
from kall.models.enums import SubscriptionPlan
from kall.services.billing import PAYMENT_GRACE_PERIOD_HOURS
from kall.services.notification_delivery import queue
from sqlmodel import Session, select


@dataclass
class GracePeriodReport:
    downgraded: list[int]  # user ids


def overdue_subscriptions(session: Session, now: datetime) -> list[Subscription]:
    cutoff = now - timedelta(hours=PAYMENT_GRACE_PERIOD_HOURS)
    return list(
        session.exec(
            select(Subscription).where(
                Subscription.payment_failed_at.is_not(None),
                Subscription.payment_failed_at <= cutoff,
                Subscription.plan != SubscriptionPlan.FREE,
            )
        )
    )


def downgrade_overdue_subscriptions(session: Session, *, now: datetime | None = None) -> GracePeriodReport:
    now = now or datetime.utcnow()
    downgraded: list[int] = []
    for subscription in overdue_subscriptions(session, now):
        subscription.plan = SubscriptionPlan.FREE
        subscription.payment_failed_at = None
        session.add(subscription)

        user = session.get(User, subscription.user_id)
        if user:
            user.plan = SubscriptionPlan.FREE
            session.add(user)

        session.commit()
        queue(session, user_id=subscription.user_id, kind="payment_grace_period_expired")
        downgraded.append(subscription.user_id)

    return GracePeriodReport(downgraded=downgraded)
