"""Who may use the admin tools, and a record of what they did with them.

Access is limited to explicitly authorized, verified accounts. A studio-domain
address alone is not sufficient: shared app-store reviewer accounts use that
domain too and must never receive administrative access.
"""

from typing import Any

from fastapi import Depends, HTTPException
from kall.auth import get_current_user
from kall.clock import utcnow
from kall.models.core import AdminAction, User
from sqlmodel import Session, select

#: Adding an administrator requires a deliberate, reviewed change.
ADMIN_EMAILS = frozenset({"james@skaldandstone.com"})


def is_admin(user: User) -> bool:
    """True only for an explicitly authorized account, ignoring email casing."""
    return (user.email or "").strip().lower() in ADMIN_EMAILS


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    # 404 rather than 403: whether an admin surface exists at all is not
    # something an ordinary account needs to learn.
    if not is_admin(current_user):
        raise HTTPException(status_code=404, detail="Not found")
    return current_user


def record_action(
    session: Session,
    actor: User,
    *,
    action: str,
    target_user_id: int,
    detail: dict[str, Any] | None = None,
) -> AdminAction:
    """Write down every change an administrator makes to someone's account.

    Support tools act on other people's accounts, so an unlogged change is
    indistinguishable from a bug or an abuse. This is append-only and there is
    no endpoint that edits or deletes it.
    """
    row = AdminAction(
        actor_user_id=actor.id,
        actor_email=actor.email,
        action=action,
        target_user_id=target_user_id,
        detail=detail or {},
        occurred_at=utcnow(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def find_users(session: Session, query: str | None, limit: int = 50) -> list[User]:
    """Search by email or name. Deliberately not a full listing by default."""
    statement = select(User).order_by(User.created_at.desc()).limit(limit)
    if query:
        pattern = f"%{query.strip().lower()}%"
        statement = select(User).where(
            (User.email.ilike(pattern)) | (User.full_name.ilike(pattern))
        ).order_by(User.created_at.desc()).limit(limit)
    return list(session.exec(statement))
