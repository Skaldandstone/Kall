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
def search_users(email: str, session: Session = Depends(get_session)) -> list[PortalUserSummary]:
    """Look up users by (partial) email address."""
    stmt = select(User).where(func.lower(User.email).contains(email.lower())).limit(20)
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
