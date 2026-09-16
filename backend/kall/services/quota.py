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
from kall.clock import utcnow
from kall.models.billing import UsageCounter
from kall.models.core import ResumeDocument, User
from kall.models.enums import SubscriptionPlan
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

Meter = Literal["applications", "ai_actions", "storage_bytes"]
Period = Literal["lifetime", "week", "month"]

#: Period key for an allowance that never refills. Storage uses it, because a
#: storage cap is a ceiling rather than a budget.
LIFETIME = "lifetime"


class Limit(NamedTuple):
    #: None means unlimited.
    amount: int | None
    period: Period


MB = 1024 * 1024

PLAN_LIMITS: dict[str, dict[Meter, Limit]] = {
    # Free and Plus refill weekly. A week is the rhythm people actually search
    # on -- a Sunday evening spent applying is one session, and a monthly cap
    # spent in the first three days leaves someone locked out for four weeks
    # with nothing to do but resent it. A weekly cap is never more than six
    # days from being useful again.
    SubscriptionPlan.FREE: {
        "applications": Limit(5, "week"),
        # Enough to see one growth plan and one resume parse -- the two moments
        # that show what the feature is for. Zero would make it invisible.
        "ai_actions": Limit(3, "week"),
        # A ceiling, not a budget: storage does not refill, it is occupied.
        "storage_bytes": Limit(25 * MB, LIFETIME),
    },
    SubscriptionPlan.PLUS: {
        "applications": Limit(25, "week"),
        "ai_actions": Limit(15, "week"),
        "storage_bytes": Limit(500 * MB, LIFETIME),
    },
    # Premium is the one plan that does not make anyone count. Its AI ceiling
    # is monthly rather than weekly so an unusually heavy week is absorbed
    # rather than refused.
    SubscriptionPlan.PREMIUM: {
        "applications": Limit(None, "week"),
        "ai_actions": Limit(400, "month"),
        "storage_bytes": Limit(5 * 1024 * MB, LIFETIME),
    },
}

#: When a limit refills, in words, so a refusal can say when to come back.
PERIOD_WORDS: dict[str, str] = {
    "week": "this week",
    "month": "this month",
    LIFETIME: "on your plan",
}


def plan_of(user: User) -> str:
    """The user's plan, tolerating a value the enum does not know."""
    return user.plan if user.plan in PLAN_LIMITS else SubscriptionPlan.FREE


def limit_for(user: User, meter: Meter) -> Limit:
    return PLAN_LIMITS[plan_of(user)][meter]


def period_key(period: Period, now: datetime | None = None) -> str:
    """The bucket a usage row belongs to.

    Weeks use the ISO calendar, so a week is always Monday to Sunday and the
    turn of the year cannot produce a short or duplicated bucket the way
    counting from January 1st would.
    """
    if period == LIFETIME:
        return LIFETIME
    moment = now or utcnow()
    if period == "week":
        iso = moment.isocalendar()
        return f"{iso.year:04d}-W{iso.week:02d}"
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
    """Bytes of *uploaded resumes* this user is keeping.

    A gauge, summed on read rather than tracked in a counter, because deleting
    a file has to give the space back.

    Deliberately scoped to what the user uploaded. Generated documents --
    tailored resumes, cover letters -- are Kall's own output, and billing
    someone for storage they did not choose to spend reads as a penalty for
    using the product. They still cost real money, but the right answer there
    is a retention policy on derived files rather than a per-user cap; they
    can always be regenerated.

    The purpose of this ceiling is therefore anti-abuse rather than revenue.
    A single resume is a few hundred kilobytes and the per-file limit is 25 MB,
    so without a ceiling one account could park gigabytes for free. It is not
    expected to bind on anyone using Kall normally.
    """
    # Keyed by storage path, not by row. create_resume_version() makes a new
    # ResumeDocument pointing at the *same* object, so counting rows would
    # bill someone twice for one file.
    by_path: dict[str, int] = {}
    for path, size in session.exec(
        select(ResumeDocument.file_path, ResumeDocument.byte_size)
        .where(ResumeDocument.user_id == user_id)
    ):
        by_path[path] = max(by_path.get(path, 0), size or 0)
    return sum(by_path.values())


def remaining(session: Session, user: User, meter: Meter) -> int | None:
    """What is left, or None when the plan does not limit this meter."""
    limit = limit_for(user, meter)
    if limit.amount is None:
        return None
    return max(0, limit.amount - used(session, user, meter))


def check(session: Session, user: User, meter: Meter, amount: int = 1) -> None:
    """Raise 402 if `amount` more would exceed the plan. Consumes nothing.

    Exempt accounts pass every check. Usage is still recorded for them, so
    support can see what an account is doing without the limit acting on it.
    """
    if user.billing_exempt:
        return
    limit = limit_for(user, meter)
    if limit.amount is None:
        return
    if used(session, user, meter) + amount <= limit.amount:
        return
    thing = {
        "applications": "completed applications",
        "ai_actions": "AI actions",
        "storage_bytes": "storage",
    }[meter]
    raise HTTPException(
        status_code=402,
        detail={
            "code": "plan_limit_reached",
            "meter": meter,
            "plan": plan_of(user),
            "limit": limit.amount,
            "period": limit.period,
            # Says when it comes back, not just that it is gone -- a weekly
            # allowance is only useful if the person knows it refills.
            "message": f"You have used all {limit.amount} of your {thing} {PERIOD_WORDS[limit.period]}.",
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
    exempt = user.billing_exempt
    for meter in ("applications", "ai_actions", "storage_bytes"):
        limit = PLAN_LIMITS[plan][meter]  # type: ignore[index]
        meters[meter] = {
            "used": used(session, user, meter),  # type: ignore[arg-type]
            # An exempt account reports no ceiling, so the product shows usage
            # without ever showing a limit approaching.
            "limit": None if exempt else limit.amount,
            "period": limit.period,
            "remaining": None if exempt else remaining(session, user, meter),  # type: ignore[arg-type]
        }
    return {"plan": plan, "billing_exempt": exempt, "meters": meters}


def reset_current_period(session: Session, user: User) -> dict[str, int]:
    """Zero the consumable meters for the current period only.

    Past periods are left as they were, so this cannot be used to quietly
    rewrite an account's history. Returns what each meter held before the
    reset so the caller can put it in the audit row.
    """
    cleared: dict[str, int] = {}
    for meter in ("applications", "ai_actions"):
        key = period_key(limit_for(user, meter).period)  # type: ignore[arg-type]
        row = _counter(session, user.id, meter, key)  # type: ignore[arg-type]
        if row is not None:
            cleared[meter] = row.used
            row.used = 0
            session.add(row)
    session.commit()
    return cleared


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
