"""Support and administration.

Every route here requires a verified address on the admin domain, and every
change is written to AdminAction. Nothing here reaches a user's own content:
an administrator can see who someone is, what their plan allows, and how much
of it they have used -- not their resumes, applications, or profile.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.db import get_session
from kall.models.core import AdminAction, User
from kall.models.enums import SubscriptionPlan
from kall.services import quota
from kall.services.admin import find_users, record_action, require_admin

router = APIRouter(tags=["admin"], prefix="/admin")


class PlanChange(BaseModel):
    plan: str
    #: Why. Recorded in the audit row, because "who changed this and why" is
    #: the question a support log has to answer.
    reason: str = ""


class ExemptChange(BaseModel):
    billing_exempt: bool
    reason: str = ""


def _summary(session: Session, user: User) -> dict[str, Any]:
    """What an administrator may see. Identity and entitlement, not content."""
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "plan": user.plan,
        "billing_exempt": user.billing_exempt,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat(),
        "usage": quota.snapshot(session, user),
    }


def _target(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(404, "No such account")
    return user


@router.get("/whoami")
def whoami(admin: User = Depends(require_admin)) -> dict[str, Any]:
    """Lets the frontend decide whether to show the admin nav at all."""
    return {"email": admin.email, "is_admin": True}


@router.get("/users")
def list_users(
    q: str | None = Query(default=None, max_length=200),
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    del admin
    return [_summary(session, user) for user in find_users(session, q)]


@router.get("/users/{user_id}")
def get_user(
    user_id: int,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    del admin
    return _summary(session, _target(session, user_id))


@router.patch("/users/{user_id}/plan")
def set_plan(
    user_id: int,
    payload: PlanChange,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if payload.plan not in set(SubscriptionPlan):
        raise HTTPException(422, f"Unknown plan: {payload.plan}")
    user = _target(session, user_id)
    previous = user.plan
    user.plan = payload.plan
    session.add(user)
    session.commit()
    session.refresh(user)
    record_action(
        session, admin,
        action="set_plan",
        target_user_id=user.id,
        detail={"from": previous, "to": payload.plan, "reason": payload.reason},
    )
    return _summary(session, user)


@router.patch("/users/{user_id}/billing-exempt")
def set_billing_exempt(
    user_id: int,
    payload: ExemptChange,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Exempt an account from every plan limit.

    The only way this flag is ever set: there is no self-serve path, which is
    the point of it existing.
    """
    user = _target(session, user_id)
    previous = user.billing_exempt
    user.billing_exempt = payload.billing_exempt
    session.add(user)
    session.commit()
    session.refresh(user)
    record_action(
        session, admin,
        action="set_billing_exempt",
        target_user_id=user.id,
        detail={"from": previous, "to": payload.billing_exempt, "reason": payload.reason},
    )
    return _summary(session, user)


@router.post("/users/{user_id}/reset-usage")
def reset_usage(
    user_id: int,
    payload: ExemptChange | None = None,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Clear the current period's counters, for when something went wrong.

    Only the current period: past periods stay as they were, so this cannot be
    used to quietly rewrite an account's history.
    """
    user = _target(session, user_id)
    cleared = {}
    for meter in ("applications", "ai_actions"):
        key = quota.period_key(quota.limit_for(user, meter).period)
        row = session.exec(
            select(quota.UsageCounter).where(
                quota.UsageCounter.user_id == user.id,
                quota.UsageCounter.meter == meter,
                quota.UsageCounter.period == key,
            )
        ).first()
        if row:
            cleared[meter] = row.used
            row.used = 0
            session.add(row)
    session.commit()
    record_action(
        session, admin,
        action="reset_usage",
        target_user_id=user.id,
        detail={"cleared": cleared, "reason": (payload.reason if payload else "")},
    )
    return _summary(session, user)


@router.get("/audit")
def audit_log(
    target_user_id: int | None = None,
    limit: int = Query(default=100, le=500),
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
) -> list[AdminAction]:
    del admin
    statement = select(AdminAction).order_by(AdminAction.occurred_at.desc()).limit(limit)
    if target_user_id is not None:
        statement = (
            select(AdminAction)
            .where(AdminAction.target_user_id == target_user_id)
            .order_by(AdminAction.occurred_at.desc())
            .limit(limit)
        )
    return list(session.exec(statement))
