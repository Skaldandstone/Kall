"""Queue a reminder once a reference has gone stale since it was last confirmed.

Reference.last_confirmed_on and permission_to_contact are fully CRUD-reachable
through the generic profile-resource registry, but nothing anywhere ever
compared last_confirmed_on against today's date -- the same "collected but
never acted on" gap already found and fixed for Certification,
WorkAuthorization, SecurityClearance, and ProfessionalMembership.

This one has a different shape from those four: it isn't a known future
expiry to warn ahead of, it's a staleness check on when the reference was
last actually confirmed. A reference someone agreed to be contacted for six
months ago may no longer be reachable, may have changed jobs, or may simply
no longer remember the details -- surfacing that before an employer calls
them cold is the point.

Scoped to permission_to_contact == True: a reference nobody has permission
to contact yet isn't "stale", it just hasn't reached that step -- that's a
UI prompt to seek permission, not a time-based reminder. Also excludes
anything marked "unavailable", the same way the fixed-window reminders
exclude an already-lapsed/inactive row.
"""

from datetime import datetime, timedelta

from kall.clock import utcnow
from kall.models import Reference
from kall.services.notification_delivery import queue
from sqlmodel import Session, select

REMINDER_STALENESS_DAYS = 180


def eligible_references(session: Session, *, now: datetime | None = None) -> list[Reference]:
    """Read references whose confirmation baseline is at least 180 days old.

    This performs no writes. Both the queue producer and the CLI dry run use
    this eligibility check, so a dry run never calls the committing outbox.
    """
    today = (now or utcnow()).date()
    with session.no_autoflush:
        references = session.exec(
            select(Reference).where(
                Reference.permission_to_contact == True,  # noqa: E712
                Reference.availability != "unavailable",
            )
        ).all()

    return [
        reference
        for reference in references
        if today >= (reference.last_confirmed_on or reference.created_at.date())
        + timedelta(days=REMINDER_STALENESS_DAYS)
    ]


def queue_reference_reminders(session: Session, *, now: datetime | None = None) -> int:
    """Queue eligible references and return the number of deliveries created.

    The dedupe key follows the current confirmation date, or creation date
    when never confirmed. Reconfirming opens a fresh reminder cycle.
    """
    references = eligible_references(session, now=now)
    for reference in references:
        baseline = reference.last_confirmed_on or reference.created_at.date()
        queue(
            session,
            user_id=reference.user_id,
            kind="reference_reminder",
            payload={
                "reference_id": reference.id,
                "name": reference.name,
                "organization": reference.organization,
                "last_confirmed_on": reference.last_confirmed_on.isoformat() if reference.last_confirmed_on else None,
                "baseline_date": baseline.isoformat(),
                "baseline_source": "last_confirmed_on" if reference.last_confirmed_on else "created_at",
            },
            dedupe_key=f"reference_reminder:{reference.id}:{baseline.isoformat()}",
        )
    return len(references)
