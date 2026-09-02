"""Queue a reminder once a professional membership's expiry enters its window.

ProfessionalMembership.expires_on is fully CRUD-reachable (the generic
profile-resource registry) but, unlike its siblings, has no expiry
reminder -- the same gap already found and fixed for Certification,
WorkAuthorization, and SecurityClearance. A lapsing bar license, PMP, or
CPA membership expires silently.

Unlike Certification, a membership has no per-row reminder_days_before --
a single fixed window is used instead, matching the shape established for
GrowthMilestone, WorkAuthorization, and SecurityClearance.
"""

from datetime import datetime, timedelta

from kall.clock import utcnow
from kall.models import ProfessionalMembership
from kall.services.notification_delivery import queue
from sqlmodel import Session, select

REMINDER_DAYS_BEFORE = 90


def queue_professional_membership_reminders(session: Session, *, now: datetime | None = None) -> int:
    """Queue one `professional_membership_reminder` delivery per membership
    that has just entered its reminder window. Returns the number queued.

    Excludes anything not `status == "active"` -- a membership already
    marked lapsed or inactive doesn't need a reminder that it's about to
    become what it already is. dedupe_key is keyed to the row's *current*
    expires_on, not just its id -- so a renewal (which moves the date
    forward) naturally opens a fresh reminder for the next cycle.
    """
    today = (now or utcnow()).date()
    memberships = session.exec(
        select(ProfessionalMembership).where(
            ProfessionalMembership.status == "active",
            ProfessionalMembership.expires_on.is_not(None),
        )
    ).all()

    queued = 0
    for membership in memberships:
        reminder_date = membership.expires_on - timedelta(days=REMINDER_DAYS_BEFORE)
        if today < reminder_date:
            continue
        queue(
            session,
            user_id=membership.user_id,
            kind="professional_membership_reminder",
            payload={
                "professional_membership_id": membership.id,
                "organization": membership.organization,
                "membership_type": membership.membership_type,
                "expires_on": membership.expires_on.isoformat(),
            },
            dedupe_key=f"professional_membership_reminder:{membership.id}:{membership.expires_on.isoformat()}",
        )
        queued += 1
    return queued
