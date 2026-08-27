"""Plan limits, and the counters they are checked against.

The old version measured one thing: completed applications, against a single
free-tier constant, on a counter that never reset. That could not express the
tiers, and more importantly it measured the wrong thing. Completed
applications are what a person is buying; they are close to uncorrelated with
what Kall spends. Someone can complete none and still run growth plans, skill
analyses and resume parses all day, each a paid API call -- while someone else
completes ten with no AI spend at all, because tailoring, matching and job
intelligence are deterministic.

So there are two kinds of meter here:

- **Counters** accumulate over a period and are consumed: applications, and
  AI actions.
- **Gauges** measure what is true right now and are not consumed: stored
  bytes. Deleting a file gives the space back, which a counter cannot express.
"""

from datetime import datetime
from typing import Literal, NamedTuple

from fastapi import HTTPException
from kall.models.billing import UsageCounter
from kall.models.core import ResumeDocument, User
from kall.models.documents import DocumentArtifact, GeneratedDocument
from kall.models.enums import SubscriptionPlan
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

Meter = Literal["applications", "ai_actions", "storage_bytes"]
Period = Literal["lifetime", "month"]

#: The lifetime period key. Free allowances are a trial, not a monthly refill:
#: "the first 10 are free" has to keep meaning that.
LIFETIME = "lifetime"


class Limit(NamedTuple):
    #: None means unlimited.
    amount: int | None
    period: Period


MB = 1024 * 1024

PLAN_LIMITS: dict[str, dict[Meter, Limit]] = {
    SubscriptionPlan.FREE: {
        "applications": Limit(10, LIFETIME),
        # Enough to see one growth plan and one resume parse -- the two moments
        # that show what the feature is for. Zero would make it invisible.
        "ai_actions": Limit(3, LIFETIME),
        "storage_bytes": Limit(25 * MB, LIFETIME),
    },
    SubscriptionPlan.PLUS: {
        "applications": Limit(50, "month"),
        "ai_actions": Limit(25, "month"),
        "storage_bytes": Limit(500 * MB, LIFETIME),
    },
    SubscriptionPlan.PREMIUM: {
        "applications": Limit(None, "month"),
        "ai_actions": Limit(150, "month"),
        "storage_bytes": Limit(5 * 1024 * MB, LIFETIME),
    },
}

UPGRADE_MESSAGE: dict[Meter, str] = {
    "applications": "You have used every completed application on your plan.",
    "ai_actions": "You have used every AI action on your plan this period.",
    "storage_bytes": "Your saved resumes and documents fill the storage on your plan.",
}


def plan_of(user: User) -> str:
    """The user's plan, tolerating a value the enum does not know."""
    return user.plan if user.plan in PLAN_LIMITS else SubscriptionPlan.FREE


def limit_for(user: User, meter: Meter) -> Limit:
    return PLAN_LIMITS[plan_of(user)][meter]


def period_key(period: Period, now: datetime | None = None) -> str:
    if period == LIFETIME:
        return LIFETIME
    moment = now or datetime.utcnow()
    return f"{moment.year:04d}-{moment.month:02d}"


def _counter(session: Session, user_id: int, meter: Meter, key: str) -> UsageCounter | None:
    return session.exec(
        select(UsageCounter).where(
            UsageCounter.user_id == user_id,
            UsageCounter.meter == meter,
            UsageCounter.period == key,
        )
    ).first()


def used(session: Session, user: User, meter: Meter) -> int:
    """How much of `meter` this user has used in the current period."""
    if meter == "storage_bytes":
        return stored_bytes(session, user.id)
    key = period_key(limit_for(user, meter).period)
    row = _counter(session, user.id, meter, key)
    return row.used if row else 0


def stored_bytes(session: Session, user_id: int) -> int:
    """Bytes this user is currently keeping in object storage.

    A gauge, summed on read rather than tracked in a counter, because deleting
    a file has to give the space back.
    """
    resumes = session.exec(
        select(ResumeDocument.byte_size).where(ResumeDocument.user_id == user_id)
    )
    artifacts = session.exec(
        select(DocumentArtifact.byte_size)
        .join(GeneratedDocument, DocumentArtifact.generated_document_id == GeneratedDocument.id)
        .where(GeneratedDocument.user_id == user_id)
    )
    return sum(size or 0 for size in resumes) + sum(size or 0 for size in artifacts)


def remaining(session: Session, user: User, meter: Meter) -> int | None:
    """What is left, or None when the plan does not limit this meter."""
    limit = limit_for(user, meter)
    if limit.amount is None:
        return None
    return max(0, limit.amount - used(session, user, meter))


def check(session: Session, user: User, meter: Meter, amount: int = 1) -> None:
    """Raise 402 if `amount` more would exceed the plan. Consumes nothing."""
    limit = limit_for(user, meter)
    if limit.amount is None:
        return
    if used(session, user, meter) + amount <= limit.amount:
        return
    raise HTTPException(
        status_code=402,
        detail={
            "code": "plan_limit_reached",
            "meter": meter,
            "plan": plan_of(user),
            "limit": limit.amount,
            "message": UPGRADE_MESSAGE[meter],
        },
    )


def consume(session: Session, user: User, meter: Meter, amount: int = 1) -> None:
    """Record usage. Call after the work succeeded, not before.

    Storage is a gauge and is never consumed -- it is measured from the files
    that actually exist.
    """
    if meter == "storage_bytes":
        return

    key = period_key(limit_for(user, meter).period)
    row = _counter(session, user.id, meter, key)
    if row is None:
        row = UsageCounter(user_id=user.id, meter=meter, period=key, used=0)
    row.used += amount
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        # Two requests created the same counter at once; re-read and add to
        # the winner rather than losing this unit.
        session.rollback()
        row = _counter(session, user.id, meter, key)
        if row is None:
            raise
        row.used += amount
        session.add(row)
        session.commit()


def snapshot(session: Session, user: User) -> dict[str, object]:
    """Everything the product needs to show usage before a limit bites.

    A quota that only ever appears as a refusal reads as a bug.
    """
    plan = plan_of(user)
    meters: dict[str, object] = {}
    for meter in ("applications", "ai_actions", "storage_bytes"):
        limit = PLAN_LIMITS[plan][meter]  # type: ignore[index]
        meters[meter] = {
            "used": used(session, user, meter),  # type: ignore[arg-type]
            "limit": limit.amount,
            "period": limit.period,
            "remaining": remaining(session, user, meter),  # type: ignore[arg-type]
        }
    return {"plan": plan, "meters": meters}


# --- Backwards-compatible helpers -------------------------------------------

def assert_application_allowed(session: Session, user: User) -> None:
    check(session, user, "applications")


def record_completed_application(session: Session, user: User) -> None:
    consume(session, user, "applications")
    # User.completed_application_count predates the counters and is still shown
    # in billing. Kept in step so nothing that reads it starts disagreeing.
    user.completed_application_count += 1
    session.add(user)
    session.commit()


def assert_ai_allowed(session: Session, user: User) -> None:
    check(session, user, "ai_actions")


def record_ai_action(session: Session, user: User) -> None:
    consume(session, user, "ai_actions")
