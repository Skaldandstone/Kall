"""Staff-only admin endpoints for the Skald & Stone Adminhelper portal.

These are not user-facing: every route requires the shared ``X-Admin-Token``
header, which the Adminhelper Worker holds as a secret. The router disables
itself entirely (404-equivalent 401s) when ADMIN_API_TOKEN is unset, so a
deployment without the secret exposes nothing.
"""

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from kall.config import get_settings
from kall.db import get_session
from kall.models.core import Application, User

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    expected = get_settings().admin_api_token
    if not expected or not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=401, detail="Admin token required")


class AdminUserSummary(BaseModel):
    id: int
    email: str
    full_name: str | None
    plan: str | None
    is_active: bool
    completed_application_count: int


class AdminUserDetail(AdminUserSummary):
    clerk_user_id: str | None
    country: str | None
    state_region: str | None
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    application_count: int


class AdminApplicationRow(BaseModel):
    id: int
    job_id: int
    status: str
    submitted_at: str | None
    failure_reason: str | None


class ActiveTogglePayload(BaseModel):
    active: bool


def _summary(user: User) -> AdminUserSummary:
    return AdminUserSummary(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        plan=str(user.plan) if user.plan is not None else None,
        is_active=user.is_active,
        completed_application_count=user.completed_application_count,
    )


@router.get("/users", dependencies=[Depends(require_admin)])
def search_users(
    email: str, session: Session = Depends(get_session)
) -> list[AdminUserSummary]:
    """Look up users by (partial) email address."""
    stmt = select(User).where(func.lower(User.email).contains(email.lower())).limit(20)
    return [_summary(u) for u in session.exec(stmt).all()]


@router.get("/users/{user_id}", dependencies=[Depends(require_admin)])
def get_user(user_id: int, session: Session = Depends(get_session)) -> AdminUserDetail:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    application_count = session.exec(
        select(func.count()).select_from(Application).where(Application.user_id == user_id)
    ).one()
    return AdminUserDetail(
        **_summary(user).model_dump(),
        clerk_user_id=user.clerk_user_id,
        country=user.country,
        state_region=user.state_region,
        stripe_customer_id=user.stripe_customer_id,
        stripe_subscription_id=user.stripe_subscription_id,
        application_count=int(application_count),
    )


@router.post("/users/{user_id}/active", dependencies=[Depends(require_admin)])
def set_user_active(
    user_id: int, payload: ActiveTogglePayload, session: Session = Depends(get_session)
) -> AdminUserSummary:
    """Activate or deactivate an account (support action)."""
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = payload.active
    session.add(user)
    session.commit()
    session.refresh(user)
    return _summary(user)


@router.get("/users/{user_id}/applications", dependencies=[Depends(require_admin)])
def recent_applications(
    user_id: int, session: Session = Depends(get_session)
) -> list[AdminApplicationRow]:
    if session.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    stmt = (
        select(Application)
        .where(Application.user_id == user_id)
        .order_by(Application.id.desc())
        .limit(10)
    )
    return [
        AdminApplicationRow(
            id=a.id,
            job_id=a.job_id,
            status=str(a.status.value if hasattr(a.status, "value") else a.status),
            submitted_at=a.submitted_at.isoformat() if a.submitted_at else None,
            failure_reason=a.failure_reason,
        )
        for a in session.exec(stmt).all()
    ]
