
from kall.clock import utcfromtimestamp, utcnow
from kall.config import get_settings
from kall.models import Subscription
from kall.models.enums import SubscriptionPlan
from kall.services.entitlements import sync_user_plan
from sqlmodel import Session, select

ACTIVE_STATUSES = {"active", "trialing"}
PAYMENT_GRACE_PERIOD_HOURS = 72


def price_for(plan: str) -> str | None:
    settings = get_settings()
    return {SubscriptionPlan.PLUS: settings.stripe_price_id,
            SubscriptionPlan.PREMIUM: settings.stripe_premium_price_id}.get(plan)


def catalog() -> dict[str, tuple[str, str]]:
    """Only explicitly configured Kall price/product pairs can grant a tier."""
    settings = get_settings()
    entries = [(SubscriptionPlan.PLUS, settings.stripe_price_id, settings.stripe_plus_product_id),
               (SubscriptionPlan.PREMIUM, settings.stripe_premium_price_id, settings.stripe_premium_product_id)]
    configured = [(str(plan), price, product) for plan, price, product in entries if price and product]
    if len({price for _, price, _ in configured}) != len(configured):
        return {}
    if len({product for _, _, product in configured}) != len(configured):
        return {}
    return {price: (plan, product) for plan, price, product in configured}


def object_id(value) -> str | None:
    return value.get("id") if isinstance(value, dict) else value if isinstance(value, str) else None


def subscription_item(payload: dict) -> dict | None:
    items = payload.get("items") or {}
    rows = items.get("data") or []
    if items.get("has_more") or len(rows) != 1 or rows[0].get("quantity", 1) != 1:
        return None
    return rows[0]


def plan_from_event(payload: dict) -> str:
    """Metadata is descriptive. The actual subscription Price is authority."""
    item = subscription_item(payload)
    price = (item or {}).get("price") or {}
    if not isinstance(price, dict):
        return SubscriptionPlan.FREE
    entry = catalog().get(price.get("id"))
    if not entry or object_id(price.get("product")) != entry[1]:
        return SubscriptionPlan.FREE
    if price.get("livemode") is not get_settings().stripe_livemode:
        return SubscriptionPlan.FREE
    return entry[0]


def get_subscription(session: Session, user_id: int, *, commit: bool = True) -> Subscription:
    item = session.exec(select(Subscription).where(Subscription.user_id == user_id)).first()
    if item:
        return item
    item = Subscription(user_id=user_id)
    session.add(item)
    if commit:
        session.commit()
    else:
        session.flush()
    session.refresh(item)
    return item


def apply_subscription_event(session: Session, user_id: int, payload: dict, *, commit: bool = True) -> Subscription:
    """Apply a current provider snapshot after the gateway verifies ownership."""
    item = get_subscription(session, user_id, commit=False)
    item.provider_customer_id = object_id(payload.get("customer")) or item.provider_customer_id
    item.provider_subscription_id = payload.get("id") or item.provider_subscription_id
    item.status = str(payload.get("status", "incomplete"))
    purchased = plan_from_event(payload)
    latest_invoice = payload.get("latest_invoice")
    paid = isinstance(latest_invoice, dict) and latest_invoice.get("status") == "paid"
    if item.status in ACTIVE_STATUSES:
        item.plan = purchased
        if paid or item.status == "trialing":
            item.payment_failed_at = None
    elif item.status == "past_due" and purchased != SubscriptionPlan.FREE:
        # Retain an existing paid allowance for the original 72-hour policy;
        # do not regrant a paid plan after the grace job has already expired it.
        if item.payment_failed_at is None and item.plan != SubscriptionPlan.FREE:
            item.payment_failed_at = utcnow()
    else:
        item.plan = SubscriptionPlan.FREE
        item.payment_failed_at = None
    sub_item = subscription_item(payload) or {}
    price = sub_item.get("price") or {}
    item.price_id = object_id(price)
    period_end = sub_item.get("current_period_end", payload.get("current_period_end"))
    item.current_period_end = utcfromtimestamp(int(period_end)) if period_end else None
    item.cancel_at_period_end = bool(payload.get("cancel_at_period_end", False))
    session.add(item)
    sync_user_plan(session, user_id)
    if commit:
        session.commit()
    else:
        session.flush()
    return item


def find_subscription_by_customer(session: Session, customer_id: str) -> Subscription | None:
    """Local lookup only. The gateway additionally verifies scope and binding."""
    return session.exec(select(Subscription).where(Subscription.provider_customer_id == customer_id)).first()


def apply_payment_failed(session: Session, subscription: Subscription, *, commit: bool = True) -> bool:
    if subscription.payment_failed_at is not None:
        return False
    subscription.payment_failed_at = utcnow()
    session.add(subscription)
    if commit:
        session.commit()
    else:
        session.flush()
    return True


def apply_payment_recovered(session: Session, subscription: Subscription, *, commit: bool = True) -> bool:
    if subscription.payment_failed_at is None:
        return False
    subscription.payment_failed_at = None
    session.add(subscription)
    if commit:
        session.commit()
    else:
        session.flush()
    return True
