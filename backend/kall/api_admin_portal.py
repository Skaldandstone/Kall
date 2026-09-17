"""Staff-only endpoints for the Skald & Stone Adminhelper portal Worker.

This is a separate surface from `/admin` (api_admin.py): that one is the
Clerk-session-gated human CS console, gated by `@skaldandstone.com` email
membership. This one is machine-to-machine -- the Adminhelper Worker holds
`ADMIN_API_TOKEN` as a secret and sends it as `X-Admin-Token` on every call.
The two happen to both describe "look up a user," but they are different
callers with different capabilities, so they live on a different path
(`/admin/portal/*`) rather than sharing routes with different auth.

The router disables itself entirely (every route 401s) when
`ADMIN_API_TOKEN` is unset, so a deployment that never configures the portal
exposes nothing new.

Deliberately omitted for now: a bulk data-subject export. Everything else
here is read-only or a narrow support toggle; an export is the one
PII-heavy surface, and it can be added later as its own reviewed change.

A token caller has no Clerk-authenticated `User`, so it cannot be an actor
in AdminAction the way api_admin.py's `record_action` expects (that helper
requires a real `User` for `actor_user_id`/`actor_email`). The Worker's own
D1 log is the authoritative audit trail for these calls; here we only best-
effort record who initiated the call, from the `X-Staff-Actor` header the
Worker forwards, as `actor_email` on an actor-less AdminAction row.
"""

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from kall.clock import utcnow
from kall.config import get_settings
from kall.db import get_session
from kall.models.core import AdminAction, Application, Job, JobMatch, User
from kall.models.enums import SubscriptionPlan
from kall.services import native_refunds, quota, stripe_billing

router = APIRouter(prefix="/admin/portal", tags=["admin-portal"])


def require_admin_token(x_admin_token: str | None = Header(default=None)) -> None:
    expected = get_settings().admin_api_token
    # compare_digest on str raises TypeError for non-ASCII input rather than
    # returning False -- encode to bytes first so a malformed header 401s
    # like any other wrong token instead of 500ing.
    if not expected or not x_admin_token or not hmac.compare_digest(x_admin_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Admin token required")


def _log(session: Session, staff_actor: str | None, *, action: str, target_user_id: int, detail: dict) -> None:
    session.add(
        AdminAction(
            actor_user_id=None,
            actor_email=staff_actor or "adminhelper-portal",
            action=action,
            target_user_id=target_user_id,
            detail=detail,
            occurred_at=utcnow(),
        )
    )
    session.commit()


class PortalUserSummary(BaseModel):
    id: int
    email: str
    support_id: str
    full_name: str | None
    plan: str | None
    is_active: bool
    completed_application_count: int


class PortalUserDetail(PortalUserSummary):
    clerk_user_id: str | None
    country: str | None
    state_region: str | None
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    application_count: int
    billing_exempt: bool
    #: quota.snapshot(): per-meter used / limit / remaining for the current
    #: period, so support can see a limit before the user reports hitting it.
    usage: dict
    plans: list[str]


class PortalApplicationRow(BaseModel):
    id: int
    job_id: int
    status: str
    submitted_at: str | None
    failure_reason: str | None


class ActiveTogglePayload(BaseModel):
    active: bool
    #: Who on the support team asked for this, forwarded from the Worker's
    #: own operator session -- there is no Clerk actor to attribute it to.
    staff_actor: str | None = None


class PlanChangePayload(BaseModel):
    plan: str
    #: Why. Recorded in the audit row, because "who changed this and why" is
    #: the question a support log has to answer.
    reason: str = ""
    staff_actor: str | None = None


class BillingExemptPayload(BaseModel):
    billing_exempt: bool
    reason: str = ""
    staff_actor: str | None = None


class ResetUsagePayload(BaseModel):
    reason: str = ""
    staff_actor: str | None = None


class RefundPayload(BaseModel):
    charge_id: str
    reason: str = ""
    staff_actor: str | None = None


class StoreRefundPayload(BaseModel):
    subscription_id: int
    reason: str = ""
    staff_actor: str | None = None


class PipelineMatchRow(BaseModel):
    job_id: int
    company: str
    title: str
    score: int
    recommendation: str


class PipelineResponse(BaseModel):
    matches: list[PipelineMatchRow]
    applications: list[PortalApplicationRow]


def _summary(user: User) -> PortalUserSummary:
    return PortalUserSummary(
        id=user.id,
        email=user.email,
        support_id=user.support_id,
        full_name=user.full_name,
        plan=str(user.plan) if user.plan is not None else None,
        is_active=user.is_active,
        completed_application_count=user.completed_application_count,
    )


def _application_row(a: Application) -> PortalApplicationRow:
    return PortalApplicationRow(
        id=a.id,
        job_id=a.job_id,
        status=str(a.status.value if hasattr(a.status, "value") else a.status),
        submitted_at=a.submitted_at.isoformat() if a.submitted_at else None,
        failure_reason=a.failure_reason,
    )


def _target(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/users", dependencies=[Depends(require_admin_token)])
def search_users(
    email: str | None = None, support_id: str | None = None, session: Session = Depends(get_session)
) -> list[PortalUserSummary]:
    """Look up users by (partial) email address, or by their exact support ID --
    the 8-digit code a user can quote instead of their email."""
    if support_id:
        stmt = select(User).where(User.support_id == support_id.strip())
    elif email:
        stmt = select(User).where(func.lower(User.email).contains(email.lower())).limit(20)
    else:
        raise HTTPException(status_code=400, detail="Provide email or support_id")
    return [_summary(u) for u in session.exec(stmt).all()]


@router.get("/users/{user_id}", dependencies=[Depends(require_admin_token)])
def get_user(user_id: int, session: Session = Depends(get_session)) -> PortalUserDetail:
    user = _target(session, user_id)
    application_count = session.exec(
        select(func.count()).select_from(Application).where(Application.user_id == user_id)
    ).one()
    return PortalUserDetail(
        **_summary(user).model_dump(),
        clerk_user_id=user.clerk_user_id,
        country=user.country,
        state_region=user.state_region,
        stripe_customer_id=user.stripe_customer_id,
        stripe_subscription_id=user.stripe_subscription_id,
        application_count=int(application_count),
        billing_exempt=user.billing_exempt,
        usage=quota.snapshot(session, user),
        plans=[str(p) for p in SubscriptionPlan],
    )


@router.post("/users/{user_id}/active", dependencies=[Depends(require_admin_token)])
def set_user_active(
    user_id: int, payload: ActiveTogglePayload, session: Session = Depends(get_session)
) -> PortalUserSummary:
    """Activate or deactivate an account (support action)."""
    user = _target(session, user_id)
    previous = user.is_active
    user.is_active = payload.active
    session.add(user)
    session.commit()
    session.refresh(user)
    _log(
        session, payload.staff_actor,
        action="portal_set_active",
        target_user_id=user.id,
        detail={"from": previous, "to": payload.active},
    )
    return _summary(user)


@router.post("/users/{user_id}/plan", dependencies=[Depends(require_admin_token)])
def set_user_plan(
    user_id: int, payload: PlanChangePayload, session: Session = Depends(get_session)
) -> PortalUserSummary:
    """Move an account between plans (support action, e.g. a comped upgrade)."""
    if payload.plan not in set(SubscriptionPlan):
        raise HTTPException(status_code=422, detail=f"Unknown plan: {payload.plan}")
    user = _target(session, user_id)
    previous = str(user.plan) if user.plan is not None else None
    user.plan = SubscriptionPlan(payload.plan)
    session.add(user)
    session.commit()
    session.refresh(user)
    _log(
        session, payload.staff_actor,
        action="portal_set_plan",
        target_user_id=user.id,
        detail={"from": previous, "to": payload.plan, "reason": payload.reason},
    )
    return _summary(user)


@router.post("/users/{user_id}/billing-exempt", dependencies=[Depends(require_admin_token)])
def set_user_billing_exempt(
    user_id: int, payload: BillingExemptPayload, session: Session = Depends(get_session)
) -> PortalUserSummary:
    """Support toggle for the billing_exempt flag; mirrors api_admin.set_billing_exempt."""
    user = _target(session, user_id)
    previous = user.billing_exempt
    user.billing_exempt = payload.billing_exempt
    session.add(user)
    session.commit()
    session.refresh(user)
    _log(
        session, payload.staff_actor,
        action="portal_set_billing_exempt",
        target_user_id=user.id,
        detail={"from": previous, "to": payload.billing_exempt, "reason": payload.reason},
    )
    return _summary(user)


@router.post("/users/{user_id}/reset-usage", dependencies=[Depends(require_admin_token)])
def reset_user_usage(
    user_id: int, payload: ResetUsagePayload, session: Session = Depends(get_session)
) -> dict:
    """Clear the current period's counters, for when something went wrong."""
    user = _target(session, user_id)
    cleared = quota.reset_current_period(session, user)
    _log(
        session, payload.staff_actor,
        action="portal_reset_usage",
        target_user_id=user.id,
        detail={"cleared": cleared, "reason": payload.reason},
    )
    return {"cleared": cleared, "usage": quota.snapshot(session, user)}


@router.get("/users/{user_id}/payments", dependencies=[Depends(require_admin_token)])
def recent_payments(user_id: int, session: Session = Depends(get_session)) -> dict:
    """Recent Stripe charges for the account, plus the refund cap the portal enforces."""
    _target(session, user_id)
    return {"charges": stripe_billing.list_customer_charges(session, user_id),
            "refund_cap_cents": get_settings().refund_cap_cents}


@router.post("/users/{user_id}/refund", dependencies=[Depends(require_admin_token)])
def refund_payment(
    user_id: int, payload: RefundPayload, session: Session = Depends(get_session)
) -> dict:
    """Refund one Stripe charge in full (admin-tier support action)."""
    user = _target(session, user_id)
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="A reason is required for a refund")
    actor = payload.staff_actor or "adminhelper-portal"
    result = stripe_billing.refund_charge(session, user.id, payload.charge_id, reason=payload.reason, actor=actor)
    _log(
        session, payload.staff_actor,
        action="portal_refund",
        target_user_id=user.id,
        detail={**result, "reason": payload.reason},
    )
    return result


@router.get("/users/{user_id}/store-subscriptions", dependencies=[Depends(require_admin_token)])
def store_subscriptions(user_id: int, session: Session = Depends(get_session)) -> dict:
    """Google Play and App Store subscriptions RevenueCat has reported for the account."""
    _target(session, user_id)
    settings = get_settings()
    return {
        "subscriptions": native_refunds.list_store_subscriptions(session, user_id),
        "google_refunds_configured": bool(settings.revenuecat_enabled and settings.revenuecat_secret_api_key),
        "apple_guidance": native_refunds.APPLE_GUIDANCE,
    }


@router.post("/users/{user_id}/store-refund", dependencies=[Depends(require_admin_token)])
def store_refund(
    user_id: int, payload: StoreRefundPayload, session: Session = Depends(get_session)
) -> dict:
    """Refund and revoke one Google Play subscription through RevenueCat (admin tier)."""
    user = _target(session, user_id)
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="A reason is required for a refund")
    actor = payload.staff_actor or "adminhelper-portal"
    result = native_refunds.refund_store_subscription(
        session, user, payload.subscription_id, reason=payload.reason, actor=actor
    )
    _log(
        session, payload.staff_actor,
        action="portal_store_refund",
        target_user_id=user.id,
        detail={"store": result["subscription"]["store"], "product_id": result["subscription"]["product_id"],
                "subscription_id": payload.subscription_id, "plan_after": result["plan_after"],
                "revenuecat_identifier": result["revenuecat_identifier"], "reason": payload.reason},
    )
    return result


class PortalActionRow(BaseModel):
    id: int
    occurred_at: str
    actor_email: str | None
    action: str
    detail: dict


@router.get("/users/{user_id}/actions", dependencies=[Depends(require_admin_token)])
def recent_actions(user_id: int, session: Session = Depends(get_session)) -> list[PortalActionRow]:
    """Every recorded staff action on this account, newest first.

    Covers both the portal's actor-less rows and the Clerk-session console's
    rows, so support sees one history regardless of which surface acted.
    """
    _target(session, user_id)
    rows = session.exec(
        select(AdminAction).where(AdminAction.target_user_id == user_id)
        .order_by(AdminAction.occurred_at.desc(), AdminAction.id.desc()).limit(50)
    ).all()
    return [
        PortalActionRow(id=a.id, occurred_at=a.occurred_at.isoformat(), actor_email=a.actor_email,
                        action=a.action, detail=a.detail or {})
        for a in rows
    ]


@router.get("/users/{user_id}/applications", dependencies=[Depends(require_admin_token)])
def recent_applications(user_id: int, session: Session = Depends(get_session)) -> list[PortalApplicationRow]:
    _target(session, user_id)
    stmt = select(Application).where(Application.user_id == user_id).order_by(Application.id.desc()).limit(10)
    return [_application_row(a) for a in session.exec(stmt).all()]


@router.get("/users/{user_id}/pipeline", dependencies=[Depends(require_admin_token)])
def pipeline_inspector(user_id: int, session: Session = Depends(get_session)) -> PipelineResponse:
    """Read-only view of a user's matched jobs and applications.

    The surface behind most "it didn't apply / why this job" tickets.
    """
    _target(session, user_id)
    match_rows = session.exec(
        select(JobMatch, Job)
        .join(Job, Job.id == JobMatch.job_id)
        .where(JobMatch.user_id == user_id)
        .order_by(JobMatch.id.desc())
        .limit(15)
    ).all()
    app_rows = session.exec(
        select(Application).where(Application.user_id == user_id).order_by(Application.id.desc()).limit(15)
    ).all()
    return PipelineResponse(
        matches=[
            PipelineMatchRow(job_id=job.id, company=job.company, title=job.title, score=match.score,
                              recommendation=match.recommendation)
            for match, job in match_rows
        ],
        applications=[_application_row(a) for a in app_rows],
    )
