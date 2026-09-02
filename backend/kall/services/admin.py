"""Who may use the admin tools, and a record of what they did with them.

Access is by email domain. That is only safe because identity is Clerk's and
Clerk verifies an address before it becomes the primary one, so a local
`User.email` ending in the admin domain means someone proved control of a
mailbox on it. If that ever stops being true -- an unverified email reaching
this column, or an import that writes it directly -- this check becomes
worthless, so it is deliberately the only rule and it lives in one place.
"""

from typing import Any

from fastapi import Depends, HTTPException
from kall.auth import get_current_user
from kall.clock import utcnow
from kall.models.core import AdminAction, User
from sqlmodel import Session, select

#: The one domain whose verified members may administer Kall.
ADMIN_EMAIL_DOMAIN = "@skaldandstone.com"


def is_admin(user: User) -> bool:
    """True for a verified address on the admin domain.

    Compared as a suffix on the lowercased address, so `casing@Domain` matches
    and `evil-skaldandstone.com` or `x@skaldandstone.com.attacker.net` do not.
    """
    return (user.email or "").strip().lower().endswith(ADMIN_EMAIL_DOMAIN)


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
