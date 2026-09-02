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

from kall.clock import utcnow
from kall.models import Subscription, User
from kall.models.enums import SubscriptionPlan
from kall.services.billing import PAYMENT_GRACE_PERIOD_HOURS
from kall.services.notification_delivery import queue
from sqlalchemy import update
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
    now = now or utcnow()
    downgraded: list[int] = []
    for subscription in overdue_subscriptions(session, now):
        # Recheck after acquiring the row's write lock. A recovered invoice may
        # have cleared the failure since the initial read; never undo it.
        result = session.execute(update(Subscription).where(
            Subscription.id == subscription.id,
            Subscription.payment_failed_at <= now - timedelta(hours=PAYMENT_GRACE_PERIOD_HOURS),
            Subscription.plan != SubscriptionPlan.FREE,
        ).values(plan=SubscriptionPlan.FREE, payment_failed_at=None))
        if result.rowcount != 1:
            session.rollback()
            continue
        session.execute(update(User).where(User.id == subscription.user_id).values(plan=SubscriptionPlan.FREE))
        session.commit()
        queue(session, user_id=subscription.user_id, kind="payment_grace_period_expired")
        downgraded.append(subscription.user_id)

    return GracePeriodReport(downgraded=downgraded)
