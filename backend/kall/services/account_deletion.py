"""Delete everything that belongs to one account.

This exists because it did not: there was no way for anyone to remove their
data, while CandidateProfile holds encrypted phone, address, EEO and
work-authorization fields, and the schema has 70+ tables that can carry a
user's rows.

**The deletion order is computed, not hand-written.** A list of "the tables
that reference a user" would be correct on the day it was written and quietly
wrong the day someone adds table #77 and forgets to update it -- and nothing
would ever notice, since the missing table just would not be in the list.
Instead this walks the schema's own foreign-key graph at call time:

  1. Find every table with a path back to user.id, however many joins deep
     (DocumentArtifact -> GeneratedDocument -> User is two hops, and nothing
     here needs to know that in advance).
  2. Delete in reverse of SQLAlchemy's own topological table order, which is
     already correct for every foreign key in the schema -- not just the ones
     that happen to point at a user -- so a child row is gone before its
     parent even across a multi-hop chain.
  3. A table with no path to a user at all (Job, DocumentTemplate: shared
     catalog data, not anyone's data) is left untouched by construction.

**Audit rows are preserved, not deleted.** AdminAction is an append-only
record of what a support action did and to whom; deleting either the actor's
or the target's rows on account removal would erase the log of the actor's
own conduct, or of what was done to the target -- either one defeats the
reason the log exists. Its user-pointing columns are set to NULL instead, the
same way actor_email already exists to survive the account behind it being
renamed or removed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from clerk_backend_api import Clerk
from fastapi import BackgroundTasks
from kall.config import get_settings
from kall.models.billing import Subscription
from kall.models.core import AccountDeletionRecord, User
from kall.services.stripe_billing import cancel_at_period_end
from sqlalchemy import Column, Table, delete, func, select, update
from sqlmodel import Session, SQLModel

logger = logging.getLogger(__name__)

#: Tables whose rows are a record of what happened, not the account's own
#: data. Never deleted; the columns named here are set to NULL instead.
#: Keyed by table name as SQLModel lowercases it.
PRESERVE_TABLES: dict[str, tuple[str, ...]] = {
    # Both columns are non-nullable FKs to user.id on a *live* row -- that
    # constrains the schema while an account exists, and says nothing about
    # what happens once it doesn't, which is exactly what this module decides.
    "adminaction": ("actor_user_id", "target_user_id"),
}


@dataclass
class DeletionReport:
    """What happened, table by table. Doubles as a dry-run preview."""

    user_id: int
    deleted: dict[str, int] = field(default_factory=dict)
    nulled: dict[str, int] = field(default_factory=dict)

    @property
    def total_rows_deleted(self) -> int:
        return sum(self.deleted.values())


def _user_fk_column(table: Table) -> Column | None:
    """The column on `table`, if any, that is a foreign key straight to user.id."""
    for column in table.columns:
        for fk in column.foreign_keys:
            if fk.column.table.name == "user" and fk.column.name == "id":
                return column
    return None


def _resolve_user_scoped_tables(metadata) -> dict[str, Column]:
    """Every table with a path back to user.id, and one column that carries it.

    A fixed point over the foreign-key graph: a table becomes user-scoped once
    any of its foreign keys points either directly at user.id or at a table
    already known to be user-scoped. Iterating to a fixed point, rather than a
    single pass, is what makes a chain of any depth resolve correctly without
    this code knowing that depth in advance.
    """
    scoped: dict[str, Column] = {}
    for table in metadata.tables.values():
        if table.name == "user":
            continue
        direct = _user_fk_column(table)
        if direct is not None:
            scoped[table.name] = direct

    changed = True
    while changed:
        changed = False
        for table in metadata.tables.values():
            if table.name == "user" or table.name in scoped:
                continue
            for column in table.columns:
                for fk in column.foreign_keys:
                    if fk.column.table.name in scoped:
                        scoped[table.name] = column
                        changed = True
                        break
                if table.name in scoped:
                    break
    return scoped


def _path_predicate(scoped: dict[str, Column], table: Table, column: Column, user_id: int):
    """A WHERE clause selecting the rows of `table` that belong to `user_id`.

    `column` is a foreign key -- either straight to user.id, or to some other
    table's primary key. The second case builds a subquery over that table,
    recursing one hop closer to the user each time, which is what lets this
    handle a chain of any depth without hard-coding how deep it is.
    """
    fk = next(iter(column.foreign_keys))
    target_table = fk.column.table
    target_pk_name = fk.column.name

    if target_table.name == "user":
        return column == user_id

    target_direct = _user_fk_column(target_table)
    if target_direct is not None:
        inner = target_direct == user_id
    else:
        target_next = scoped.get(target_table.name)
        if target_next is None:
            raise AssertionError(
                f"{target_table.name} was resolved as user-scoped but has no known path to user"
            )
        inner = _path_predicate(scoped, target_table, target_next, user_id)

    return column.in_(select(target_table.c[target_pk_name]).where(inner))


def _count(session: Session, table: Table, predicate: Any) -> int:
    return session.execute(select(func.count()).select_from(table).where(predicate)).scalar() or 0


def plan_deletion(session: Session, user_id: int) -> DeletionReport:
    """Count what a deletion would touch, without touching anything."""
    return _run(session, user_id, execute=False)


def delete_account(
    session: Session,
    user_id: int,
    *,
    reason: str = "self_service",
    background_tasks: BackgroundTasks | None = None,
) -> DeletionReport:
    """Delete everything belonging to `user_id`, including the account itself.

    Runs as one transaction: either the whole account is gone or nothing is.
    Calling it again for an id that no longer exists reports zero rows rather
    than raising.

    Writes one AccountDeletionRecord first, capturing the email and Clerk id
    while the account still exists to describe them -- deliberately not
    foreign keys, so the row answers "was this account deleted, and when"
    after there is nothing left to join against.

    Also attempts to delete the Clerk user. This matters more than it looks:
    Clerk owns the session, not this database, so a browser that is still
    signed in survives the local deletion untouched. Its very next request
    would otherwise reach ensure_local_user() with a clerk_user_id that no
    longer has a User row -- which is exactly the "create on first sight"
    case ensure_local_user() exists for, so it would silently build a fresh
    account and the deletion would look like it never happened. Deleting the
    Clerk user invalidates that session at the source, which is the reliable
    fix. The AccountDeletionRecord is the fallback for when this call fails
    or the deployment has no Clerk key at all (tests, local dev): see the
    tombstone check in auth.ensure_local_user.

    Also sets any Stripe subscription to cancel at the end of the period
    already paid for, before the local rows naming it are deleted. Both
    provider calls are best-effort for the same reason: neither Clerk nor
    Stripe being reachable is a condition someone's deletion request should
    depend on.

    **The Clerk call runs after the local deletion commits, and in the
    background when `background_tasks` is given.** Confirmed live: on an
    account with enough rows, the local deletion plus a slow third-party
    network call to Clerk together took long enough that the connection
    back to the browser was dropped before the response arrived, even
    though the deletion itself succeeded -- the caller saw nothing but a
    hung request while the account was already gone. The local deletion is
    the part that actually matters and the part this function can make
    fast and consistent; Clerk's own cleanup is best-effort regardless of
    when it runs (see `_delete_clerk_user`'s own swallowed-exception
    handling), so there is nothing to gain and real latency to lose by
    making the caller wait on it. Without `background_tasks` (direct calls,
    tests), it still runs synchronously after the commit.
    """
    user = session.get(User, user_id)
    if user is None:
        return _run(session, user_id, execute=True)

    clerk_user_id = user.clerk_user_id
    session.add(AccountDeletionRecord(email=user.email, clerk_user_id=clerk_user_id or "", reason=reason))
    _cancel_billing(session, user_id)

    report = _run(session, user_id, execute=True)
    session.commit()

    if background_tasks is not None:
        background_tasks.add_task(_delete_clerk_user, clerk_user_id)
    else:
        _delete_clerk_user(clerk_user_id)

    return report


def _delete_clerk_user(clerk_user_id: str | None) -> None:
    if not clerk_user_id:
        return
    settings = get_settings()
    if not settings.clerk_secret_key:
        return
    try:
        with Clerk(bearer_auth=settings.clerk_secret_key) as clerk:
            clerk.users.delete(user_id=clerk_user_id)
    except Exception:
        # Never let a Clerk-side failure abort a local deletion the person
        # asked for -- the AccountDeletionRecord tombstone still prevents
        # ensure_local_user() from resurrecting the account even if this call
        # did not go through.
        logger.warning("Could not delete Clerk user %s during account deletion", clerk_user_id, exc_info=True)


def _cancel_billing(session: Session, user_id: int) -> None:
    """Stop the subscription renewing, before the row that names it is deleted.

    Deleting the account removes the local billing rows, so after this point
    nothing here knows the subscription exists -- and the webhook that would
    normally reconcile it has no row to write to either. Stripe keeps charging
    a card for an account that no longer exists, and the person has no account
    left to cancel from. This is the call that prevents that.

    Cancellation is at period end, not immediate: see
    stripe_billing.cancel_at_period_end for why, and docs/LEGAL.md for the
    decision behind it.

    Best-effort, exactly like the Clerk deletion above: a billing provider
    that is down must not block a deletion someone asked for. The failure is
    logged with the subscription id precisely because nothing local will
    remember it afterwards -- that log line is the only remaining route to
    cancelling it by hand.
    """
    # Read before the attempt, not in the failure handler: whatever went wrong
    # may be the reason a second query would fail too, and this id is the one
    # thing the log line has to carry.
    subscription_id = session.execute(
        select(Subscription.provider_subscription_id).where(Subscription.user_id == user_id)
    ).scalars().first()
    try:
        cancelled = cancel_at_period_end(session, user_id)
    except Exception:
        logger.warning(
            "Could not cancel Stripe subscription %s for user %s during account deletion; "
            "it may keep billing until cancelled by hand",
            subscription_id, user_id, exc_info=True,
        )
    else:
        if cancelled:
            logger.info("Set Stripe subscription %s to cancel at period end for deleted user %s",
                        cancelled, user_id)


def _run(session: Session, user_id: int, *, execute: bool) -> DeletionReport:
    metadata = SQLModel.metadata
    scoped = _resolve_user_scoped_tables(metadata)
    report = DeletionReport(user_id=user_id)

    # Reverse of SQLAlchemy's own topological order: correct for every
    # foreign key in the schema, not only the ones this module cares about,
    # so a child row is always handled before the parent it points to, even
    # across a multi-hop chain this module never had to reason about directly.
    for table in reversed(metadata.sorted_tables):
        if table.name == "user":
            continue

        if table.name in PRESERVE_TABLES:
            for column_name in PRESERVE_TABLES[table.name]:
                predicate = table.c[column_name] == user_id
                count = _count(session, table, predicate)
                if count:
                    report.nulled[f"{table.name}.{column_name}"] = count
                    if execute:
                        session.execute(update(table).where(predicate).values({column_name: None}))
            continue

        column = scoped.get(table.name)
        if column is None:
            continue  # Shared data with no path to any specific user.

        predicate = _path_predicate(scoped, table, column, user_id)
        count = _count(session, table, predicate)
        if count:
            report.deleted[table.name] = count
            if execute:
                session.execute(delete(table).where(predicate))

    user_table = metadata.tables["user"]
    existing = _count(session, user_table, user_table.c.id == user_id)
    if existing:
        report.deleted["user"] = existing
        if execute:
            session.execute(delete(user_table).where(user_table.c.id == user_id))

    return report
