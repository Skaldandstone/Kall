"""Configured prices grant plans; provider metadata never does."""
import pytest
from billing_fakes import price
from kall.models import User
from kall.services.billing import apply_subscription_event, plan_from_event
from sqlmodel import Session

pytestmark = pytest.mark.usefixtures("stripe_gateway")


def payload(plan="premium", **kwargs):
    return {"status": "active", "id": "sub_local", "customer": "cus_local",
            "items": {"data": [{"quantity": 1, "price": price(plan)}]}, **kwargs}


def test_configured_price_overrides_misleading_metadata():
    assert plan_from_event(payload("plus", metadata={"kall_plan": "premium"})) == "plus"
    assert plan_from_event(payload()) == "premium"


@pytest.mark.parametrize("event", [{}, {"metadata": {"kall_plan": "premium"}},
    {"items": {"data": [{"price": "price_premium"}]}},
    {"items": {"data": [{"price": price(), "quantity": 2}]}},
    {"items": {"data": [{"price": price()}, {"price": price("plus")}]}}])
def test_unknown_or_ambiguous_purchase_is_free(event):
    assert plan_from_event(event) == "free"


def test_buying_then_cancelling_updates_the_authoritative_user(engine):
    with Session(engine) as session:
        user = User(clerk_user_id="buyer", email="buyer@example.com", full_name="Buyer")
        session.add(user)
        session.commit()
        row = apply_subscription_event(session, user.id, payload())
        session.refresh(user)
        assert row.plan == user.plan == "premium"
        apply_subscription_event(session, user.id, payload(status="canceled"))
        session.refresh(user)
        assert row.plan == user.plan == "free"
