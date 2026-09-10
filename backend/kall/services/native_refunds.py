"""Staff refunds for Google Play subscriptions, issued through RevenueCat.

Kall never holds store receipts or purchase tokens; RevenueCat owns the
store connection. Its v1 API can revoke a Google Play subscription, which
refunds the latest purchase and ends access in one step. Apple offers no
developer-initiated refund at all, so App Store rows are listed for context
and the refund call refuses them with the customer-facing steps instead.

Local state is updated only after RevenueCat confirms, and the entitlement
is recomputed from every remaining billing source so a customer with an
active Stripe plan keeps it.
"""

from __future__ import annotations

import httpx
from fastapi import HTTPException
from kall.clock import utcnow
from kall.config import get_settings
from kall.models import StoreSubscription, User
from kall.services.entitlements import sync_user_plan
from sqlmodel import Session, select

REVENUECAT_API = "https://api.revenuecat.com/v1"
REFUNDABLE_STATUSES = {"active", "cancelling", "billing_issue"}
APPLE_GUIDANCE = (
    "Apple issues App Store refunds itself. Ask the customer to request one at "
    "reportaproblem.apple.com; Kall receives the result through RevenueCat."
)


def _summary(row: StoreSubscription) -> dict:
    return {
        "id": row.id,
        "store": row.store,
        "environment": row.environment,
        "product_id": row.product_id,
        "plan": row.plan,
        "status": row.status,
        "active_until": row.active_until.isoformat() if row.active_until else None,
        "will_renew": row.will_renew,
        "last_event_at": row.last_event_at.isoformat(),
        "refundable": row.store == "PLAY_STORE" and row.status in REFUNDABLE_STATUSES,
    }


def list_store_subscriptions(session: Session, user_id: int) -> list[dict]:
    rows = session.exec(
        select(StoreSubscription).where(StoreSubscription.user_id == user_id)
        .order_by(StoreSubscription.last_event_at.desc())
    ).all()
    return [_summary(r) for r in rows]


class RevenueCatRefused(Exception):
    """RevenueCat answered with an error status; the body is never surfaced."""

    def __init__(self, status: int) -> None:
        super().__init__(f"RevenueCat HTTP {status}")
        self.status = status


def revenuecat_post(path: str, api_key: str) -> dict:
    """One authenticated RevenueCat v1 call. Kept separate so tests fake it."""
    try:
        response = httpx.post(
            f"{REVENUECAT_API}{path}",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=15,
        )
    except httpx.HTTPError:
        raise HTTPException(503, "RevenueCat is unavailable; please retry") from None
    if response.status_code >= 400:
        # Provider bodies can echo identifiers; keep the status, drop the text.
        raise RevenueCatRefused(response.status_code)
    try:
        return response.json()
    except ValueError:
        return {}


def _revoke_identifiers(product_id: str) -> list[str]:
    """Identifiers to try, in order, on RevenueCat's revoke path.

    RevenueCat keys a subscriber's subscriptions by its own product identifier,
    which for Google Play products created after February 2023 is
    "<subscription_id>:<base_plan_id>" -- the exact value Kall stores from the
    webhook. Its revoke endpoint is documented only as taking "the product
    identifier", so the stored value goes first; the bare Google subscription
    id is the fallback if RevenueCat reports it unknown. The audit row records
    which form succeeded so the fallback can be removed once sandbox proves it.
    """
    forms = [product_id]
    bare = product_id.split(":", 1)[0]
    if bare and bare != product_id:
        forms.append(bare)
    return forms


def refund_store_subscription(
    session: Session, user: User, subscription_id: int, *, reason: str, actor: str
) -> dict:
    """Refund and revoke one Google Play subscription (staff action)."""
    settings = get_settings()
    row = session.get(StoreSubscription, subscription_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Store subscription not found for this account")
    if row.store == "APP_STORE":
        raise HTTPException(409, APPLE_GUIDANCE)
    if row.store != "PLAY_STORE":
        raise HTTPException(409, "Only Google Play subscriptions can be refunded here")
    if row.status == "refunded":
        raise HTTPException(409, "This subscription has already been refunded")
    if row.status not in REFUNDABLE_STATUSES:
        raise HTTPException(409, f"A {row.status} subscription has nothing left to refund")
    if not settings.revenuecat_enabled or not settings.revenuecat_secret_api_key:
        raise HTTPException(503, "Native billing refunds are not configured on this deployment")
    if not user.clerk_user_id:
        raise HTTPException(409, "This account has no RevenueCat identity")

    # RevenueCat's revoke refunds the most recent Google purchase and ends the
    # subscription. See _revoke_identifiers for why two forms may be tried.
    used_identifier: str | None = None
    for identifier in _revoke_identifiers(row.product_id):
        try:
            revenuecat_post(
                f"/subscribers/{user.clerk_user_id}/subscriptions/{identifier}/revoke",
                settings.revenuecat_secret_api_key,
            )
        except RevenueCatRefused as refused:
            if refused.status == 404:
                continue
            raise HTTPException(503, f"RevenueCat refused the refund (HTTP {refused.status})") from None
        used_identifier = identifier
        break
    if used_identifier is None:
        raise HTTPException(409, "RevenueCat does not recognise this subscription for the customer")

    now = utcnow()
    row.status = "refunded"
    row.will_renew = False
    row.active_until = now
    row.last_event_at = now
    session.add(row)
    session.flush()
    plan = sync_user_plan(session, user.id, now)
    session.commit()
    session.refresh(row)
    return {"subscription": _summary(row), "plan_after": plan, "reason": reason, "actor": actor,
            "revenuecat_identifier": used_identifier}
