"""Database compare-and-set leases shared by workers and HTTP admission checks."""

from datetime import datetime, timedelta
from uuid import uuid4

from kall.models.monitoring import MonitoringLease
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session


def acquire(session: Session, key: str, now: datetime, *, seconds: int = 180, user_id: int | None = None) -> str | None:
    # A unique primary key serializes first creation. A savepoint keeps a
    # losing insert from rolling back the caller's unrelated transaction.
    if session.get(MonitoringLease, key) is None:
        try:
            with session.begin_nested():
                session.add(MonitoringLease(key=key, user_id=user_id))
                session.flush()
        except IntegrityError:
            pass
    token = uuid4().hex
    result = session.execute(
        update(MonitoringLease).where(
            MonitoringLease.key == key, MonitoringLease.expires_at <= now,
        ).values(token=token, expires_at=now + timedelta(seconds=seconds))
    )
    session.commit()
    return token if result.rowcount == 1 else None


def release(session: Session, key: str, token: str) -> None:
    # An expired worker may not release the lease owned by its replacement.
    session.execute(update(MonitoringLease).where(
        MonitoringLease.key == key, MonitoringLease.token == token,
    ).values(token=None, expires_at=datetime.min))
    session.commit()
