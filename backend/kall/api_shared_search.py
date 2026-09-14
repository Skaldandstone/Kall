from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import CareerProfile, SharedSearch, User
from kall.rate_limit import limiter
from kall.services.shared_search import (
    CRITERIA_FIELDS,
    generate_slug,
    refresh_if_stale,
)

router = APIRouter(tags=["shared-search"])

#: Bounds how many public digest pages one account can keep alive at once --
#: a simple count guard rather than a full quota-service integration, since
#: this is about the size of the public surface one account can generate,
#: not a paid-plan allowance.
MAX_ACTIVE_SHARES_PER_USER = 15


class ShareCreate(BaseModel):
    #: Exactly one of these three should be meaningfully set -- validated
    #: below rather than with a discriminated union, so a client sending an
    #: unexpected combination gets one clear error message.
    source_profile_id: int | None = None
    criteria: dict[str, Any] | None = None
    mode: str | None = None  # "invite" for path 3
    friend_label: str | None = None


class CriteriaSubmit(BaseModel):
    criteria: dict[str, Any]


def _public_share(share: SharedSearch) -> dict[str, Any]:
    """Only what a stranger needs -- never the owner's id or friend_label."""
    if share.status == "awaiting_input":
        return {"status": share.status}
    return {
        "status": share.status,
        "results": share.last_digest or [],
        "last_refreshed_at": share.last_refreshed_at,
    }


@router.post("/me/shared-searches", response_model=SharedSearch)
async def create_shared_search(
    payload: ShareCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SharedSearch:
    active_count = session.exec(
        select(SharedSearch).where(
            SharedSearch.owner_user_id == current_user.id,
            SharedSearch.status != "revoked",
        )
    ).all()
    if len(active_count) >= MAX_ACTIVE_SHARES_PER_USER:
        raise HTTPException(422, f"You can have at most {MAX_ACTIVE_SHARES_PER_USER} active shares. Revoke one first.")

    share = SharedSearch(owner_user_id=current_user.id, slug=generate_slug(session), friend_label=payload.friend_label)
    if payload.source_profile_id:
        profile = session.get(CareerProfile, payload.source_profile_id)
        if not profile or profile.user_id != current_user.id:
            raise HTTPException(404, "Professional profile not found")
        share.source_profile_id = payload.source_profile_id
        share.status = "active"
    elif payload.criteria:
        share.criteria = {key: payload.criteria.get(key, []) for key in CRITERIA_FIELDS}
        share.status = "active"
    elif payload.mode == "invite":
        share.status = "awaiting_input"
    else:
        raise HTTPException(422, "Provide source_profile_id, criteria, or mode='invite'")

    session.add(share)
    session.commit()
    session.refresh(share)
    if share.status == "active":
        share = await refresh_if_stale(session, share, force=True)
    return share


@router.get("/me/shared-searches", response_model=list[SharedSearch])
def list_shared_searches(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SharedSearch]:
    return list(
        session.exec(
            select(SharedSearch)
            .where(SharedSearch.owner_user_id == current_user.id)
            .order_by(SharedSearch.created_at.desc())
        )
    )


@router.delete("/me/shared-searches/{share_id}")
def revoke_shared_search(
    share_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    share = session.get(SharedSearch, share_id)
    if not share or share.owner_user_id != current_user.id:
        raise HTTPException(404, "Share not found")
    share.status = "revoked"
    session.add(share)
    session.commit()
    return {"status": "revoked"}


@router.get("/shared-searches/{slug}")
@limiter.limit("60/hour")
async def public_shared_search(slug: str, request: Request, session: Session = Depends(get_session)) -> dict[str, Any]:
    """The public digest. No authentication, so -- like /career-pages/{slug}
    -- a missing or revoked share is always a 404, never a distinguishable
    403; a stranger cannot tell "never existed" from "taken down"."""
    del request  # required by slowapi's key_func, unused otherwise
    share = session.exec(select(SharedSearch).where(SharedSearch.slug == slug)).first()
    if not share or share.status == "revoked":
        raise HTTPException(404, "No shared search at that address")
    share.view_count += 1
    session.add(share)
    session.commit()
    if share.status == "active":
        share = await refresh_if_stale(session, share)
    return _public_share(share)


@router.post("/shared-searches/{slug}/criteria")
@limiter.limit("10/hour")
async def submit_shared_search_criteria(
    slug: str,
    payload: CriteriaSubmit,
    request: Request,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    del request
    share = session.exec(select(SharedSearch).where(SharedSearch.slug == slug)).first()
    if not share or share.status != "awaiting_input":
        raise HTTPException(404, "No pending shared search at that address")
    share.criteria = {key: payload.criteria.get(key, []) for key in CRITERIA_FIELDS}
    share.status = "active"
    session.add(share)
    session.commit()
    session.refresh(share)
    share = await refresh_if_stale(session, share, force=True)
    return _public_share(share)


@router.post("/shared-searches/{slug}/refresh")
@limiter.limit("5/hour")
async def refresh_shared_search(slug: str, request: Request, session: Session = Depends(get_session)) -> dict[str, Any]:
    del request
    share = session.exec(select(SharedSearch).where(SharedSearch.slug == slug)).first()
    if not share or share.status != "active":
        raise HTTPException(404, "No shared search at that address")
    share = await refresh_if_stale(session, share, force=True)
    return _public_share(share)
