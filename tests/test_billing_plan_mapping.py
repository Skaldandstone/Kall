"""Which plan a Stripe event grants.

Two bugs these pin down, both found while writing the Stripe runbook:
the handler hardcoded "plus" regardless of what was bought, and it only
ever wrote Subscription.plan -- never User.plan, which is the field the
quota service actually reads.
"""

from kall.models.core import User
from kall.models.enums import SubscriptionPlan
from kall.services.billing import apply_subscription_event, plan_from_event
from sqlmodel import Session


def test_metadata_names_the_plan() -> None:
    assert plan_from_event({"metadata": {"kall_plan": "premium"}}) == SubscriptionPlan.PREMIUM
    assert plan_from_event({"metadata": {"kall_plan": "plus"}}) == SubscriptionPlan.PLUS


def test_an_unknown_plan_in_metadata_does_not_grant_the_top_tier() -> None:
    """Metadata is attacker-adjacent data; it must not be trusted blindly."""
    assert plan_from_event({"metadata": {"kall_plan": "enterprise"}}) == SubscriptionPlan.PLUS
    assert plan_from_event({}) == SubscriptionPlan.PLUS


def test_buying_premium_grants_premium(engine) -> None:
    with Session(engine) as session:
        user = User(clerk_user_id="user_buyer", email="buyer@example.com", full_name="Buyer")
        session.add(user)
        session.commit()
        session.refresh(user)

        apply_subscription_event(
            session, user.id,
            {"status": "active", "customer": "cus_1", "id": "sub_1",
             "metadata": {"kall_plan": "premium"}},
        )
        session.refresh(user)
        # Both records move: the subscription, and the account the limits read.
        assert user.plan == SubscriptionPlan.PREMIUM


def test_cancelling_returns_the_account_to_free(engine) -> None:
    with Session(engine) as session:
        user = User(clerk_user_id="user_cancel", email="cancel@example.com",
                    full_name="Cancel", plan=SubscriptionPlan.PREMIUM)
        session.add(user)
        session.commit()
        session.refresh(user)

        apply_subscription_event(
            session, user.id,
            {"status": "canceled", "customer": "cus_2", "id": "sub_2",
             "metadata": {"kall_plan": "premium"}},
        )
        session.refresh(user)
        assert user.plan == SubscriptionPlan.FREE
