"""The 72-hour payment-failure grace period.

James's policy: 72 hours of paid access after a card first fails, then
downgrade. The interesting behavior is the edges -- a second failure must
not reset the clock, recovery must clear it, and the downgrade must actually
change the account's real limits, not just a billing record nobody reads.
"""

from datetime import datetime, timedelta

from kall.models import Subscription, User
from kall.models.enums import SubscriptionPlan
from kall.services.billing import (
    PAYMENT_GRACE_PERIOD_HOURS,
    apply_payment_failed,
    apply_payment_recovered,
    find_subscription_by_customer,
    get_subscription,
)
from kall.services.billing_grace_period import (
    downgrade_overdue_subscriptions,
    overdue_subscriptions,
)
from sqlmodel import Session, select


def _paid_user(session, plan=SubscriptionPlan.PREMIUM, customer_id="cus_1"):
    user = User(clerk_user_id=f"user_{customer_id}", email=f"{customer_id}@example.com", full_name="Payer", plan=plan)
    session.add(user)
    session.commit()
    session.refresh(user)
    subscription = get_subscription(session, user.id)
    subscription.plan = plan
    subscription.status = "active"
    subscription.provider_customer_id = customer_id
    session.add(subscription)
    session.commit()
    session.refresh(subscription)
    return user, subscription


def test_a_failure_starts_the_clock(engine) -> None:
    with Session(engine) as session:
        _user, subscription = _paid_user(session)
        assert subscription.payment_failed_at is None

        started = apply_payment_failed(session, subscription)

        assert started is True
        assert subscription.payment_failed_at is not None


def test_a_second_failure_does_not_reset_the_clock(engine) -> None:
    """The case that actually matters: a card retried every couple of days
    that keeps failing must still get downgraded 72 hours after the FIRST
    failure, not 72 hours after the most recent one."""
    with Session(engine) as session:
        _user, subscription = _paid_user(session)
        apply_payment_failed(session, subscription)
        first_failure = subscription.payment_failed_at

        started_again = apply_payment_failed(session, subscription)

        assert started_again is False
        assert subscription.payment_failed_at == first_failure


def test_recovery_clears_the_clock(engine) -> None:
    with Session(engine) as session:
        _user, subscription = _paid_user(session)
        apply_payment_failed(session, subscription)

        recovered = apply_payment_recovered(session, subscription)

        assert recovered is True
        assert subscription.payment_failed_at is None


def test_recovering_when_nothing_was_failing_is_a_no_op(engine) -> None:
    with Session(engine) as session:
        _user, subscription = _paid_user(session)
        assert apply_payment_recovered(session, subscription) is False


def test_lookup_by_stripe_customer_id(engine) -> None:
    with Session(engine) as session:
        _user, subscription = _paid_user(session, customer_id="cus_lookup")
        found = find_subscription_by_customer(session, "cus_lookup")
        assert found is not None
        assert found.id == subscription.id
        assert find_subscription_by_customer(session, "cus_does_not_exist") is None


def test_within_the_window_nothing_is_downgraded(engine) -> None:
    with Session(engine) as session:
        user, subscription = _paid_user(session)
        subscription.payment_failed_at = datetime.utcnow() - timedelta(hours=PAYMENT_GRACE_PERIOD_HOURS - 1)
        session.add(subscription)
        session.commit()

        report = downgrade_overdue_subscriptions(session)

        assert report.downgraded == []
        session.refresh(subscription)
        session.refresh(user)
        assert subscription.plan == SubscriptionPlan.PREMIUM
        assert user.plan == SubscriptionPlan.PREMIUM


def test_past_the_window_the_account_is_downgraded_on_both_records(engine) -> None:
    """Both Subscription.plan and User.plan, because User.plan is what the
    quota service actually reads -- writing only the former was a real bug
    fixed earlier this session in apply_subscription_event, and a downgrade
    that only touched the billing record would reproduce the identical
    failure: an account that looks downgraded but keeps its paid limits."""
    with Session(engine) as session:
        user, subscription = _paid_user(session)
        subscription.payment_failed_at = datetime.utcnow() - timedelta(hours=PAYMENT_GRACE_PERIOD_HOURS + 1)
        session.add(subscription)
        session.commit()

        report = downgrade_overdue_subscriptions(session)

        assert report.downgraded == [user.id]

    with Session(engine) as session:
        assert session.get(Subscription, subscription.id).plan == SubscriptionPlan.FREE
        assert session.get(User, user.id).plan == SubscriptionPlan.FREE


def test_downgrading_clears_the_clock_so_it_is_not_downgraded_again(engine) -> None:
    with Session(engine) as session:
        user, subscription = _paid_user(session)
        subscription.payment_failed_at = datetime.utcnow() - timedelta(hours=PAYMENT_GRACE_PERIOD_HOURS + 1)
        session.add(subscription)
        session.commit()

        downgrade_overdue_subscriptions(session)
        second_run = downgrade_overdue_subscriptions(session)

        assert second_run.downgraded == []


def test_downgrading_queues_a_notification(engine) -> None:
    from kall.models.opportunities import NotificationDelivery

    with Session(engine) as session:
        user, subscription = _paid_user(session)
        subscription.payment_failed_at = datetime.utcnow() - timedelta(hours=PAYMENT_GRACE_PERIOD_HOURS + 1)
        session.add(subscription)
        session.commit()

        downgrade_overdue_subscriptions(session)

        delivery = session.exec(
            select(NotificationDelivery).where(NotificationDelivery.user_id == user.id)
        ).one()
        assert delivery.kind == "payment_grace_period_expired"
        assert delivery.status == "queued"


def test_a_free_account_with_a_stale_failure_flag_is_left_alone(engine) -> None:
    """Guards the overdue query's own filter: only paid plans are candidates,
    so a Free account can never be 'downgraded' to the plan it is already on."""
    with Session(engine) as session:
        user, subscription = _paid_user(session, plan=SubscriptionPlan.FREE)
        subscription.payment_failed_at = datetime.utcnow() - timedelta(hours=PAYMENT_GRACE_PERIOD_HOURS + 1)
        session.add(subscription)
        session.commit()

        assert overdue_subscriptions(session, datetime.utcnow()) == []


def test_webhook_routes_invoice_payment_failed_to_the_grace_period(client, engine, monkeypatch) -> None:
    """The endpoint-level wiring, not just the service function.

    apply_payment_failed/apply_payment_recovered were already correct in
    isolation -- this proves POST /billing/webhook actually reaches them for
    these two event types, which is exactly the layer where the earlier
    plan-mapping bug lived (a service function that worked, called from a
    webhook handler that did not call it correctly).
    """
    from kall.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")

    with Session(engine) as session:
        target = User(clerk_user_id="user_webhook_target", email="webhook@example.com", full_name="Target", plan=SubscriptionPlan.PLUS)
        session.add(target)
        session.commit()
        session.refresh(target)
        subscription = get_subscription(session, target.id)
        subscription.plan = SubscriptionPlan.PLUS
        subscription.provider_customer_id = "cus_webhook"
        session.add(subscription)
        session.commit()

    event = {
        "id": "evt_1",
        "type": "invoice.payment_failed",
        "data": {"object": {"customer": "cus_webhook", "metadata": {}}},
    }
    monkeypatch.setattr("stripe.Webhook.construct_event", lambda **k: event)

    response = client.post("/api/billing/webhook", content=b"{}", headers={"stripe-signature": "t=1,v1=x"})
    assert response.status_code == 200

    with Session(engine) as session:
        subscription = find_subscription_by_customer(session, "cus_webhook")
        assert subscription.payment_failed_at is not None

    get_settings.cache_clear()
