"""Queue a reminder once a security clearance's expiry enters its window.

SecurityClearance.expires_on is collected but nothing anywhere ever compared
it against today's date -- letting a clearance lapse silently before a
cleared role's application went out is at least as consequential as the
Certification and WorkAuthorization cases this same gap was already found
and fixed for.

Unlike Certification, a clearance has no per-row reminder_days_before to
configure -- a single fixed window is used instead, matching the shape
established for GrowthMilestone and WorkAuthorization.
"""

from datetime import datetime, timedelta

from kall.clock import utcnow
from kall.models import SecurityClearance
from kall.services.notification_delivery import queue
from sqlmodel import Session, select

#: Not user-configurable, unlike Certification.reminder_days_before -- a
#: clearance has no equivalent per-row setting. 90 days matches a
#: certification's typical default and gives realistic lead time for a
#: clearance renewal/reinvestigation process.
REMINDER_DAYS_BEFORE = 90


def queue_security_clearance_reminders(session: Session, *, now: datetime | None = None) -> int:
    """Queue one `security_clearance_reminder` delivery per clearance that
    has just entered its reminder window. Returns the number queued.

    Excludes anything not `status == "active"` -- a clearance already
    marked expired or inactive doesn't need a reminder that it's about to
    become what it already is. dedupe_key is keyed to the row's *current*
    expires_on, not just its id -- so a renewal (which moves the date
    forward) naturally opens a fresh reminder for the next cycle.
    """
    today = (now or utcnow()).date()
    clearances = session.exec(
        select(SecurityClearance).where(
            SecurityClearance.status == "active",
            SecurityClearance.expires_on.is_not(None),
        )
    ).all()

    queued = 0
    for clearance in clearances:
        reminder_date = clearance.expires_on - timedelta(days=REMINDER_DAYS_BEFORE)
        if today < reminder_date:
            continue
        queue(
            session,
            user_id=clearance.user_id,
            kind="security_clearance_reminder",
            payload={
                "security_clearance_id": clearance.id,
                "clearance_type": clearance.clearance_type,
                "country": clearance.country,
                "expires_on": clearance.expires_on.isoformat(),
            },
            dedupe_key=f"security_clearance_reminder:{clearance.id}:{clearance.expires_on.isoformat()}",
        )
        queued += 1
    return queued
