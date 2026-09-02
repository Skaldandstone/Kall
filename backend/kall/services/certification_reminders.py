"""Queue a renewal reminder once a certification's expiry enters its window.

Certification.renewal_required and reminder_days_before were both writable --
the profile editor even has a "Renewal required" checkbox -- but nothing
anywhere ever read either field. Checking that box did nothing at all. This
is the missing piece, using the same outbox everything else in
notification_delivery.py drains.
"""

from datetime import datetime, timedelta

from kall.clock import utcnow
from kall.models import Certification
from kall.services.notification_delivery import queue
from sqlmodel import Session, select


def queue_certification_reminders(session: Session, *, now: datetime | None = None) -> int:
    """Queue one `certification_renewal` delivery per certification that has
    just entered its reminder window. Returns the number queued.

    dedupe_key is keyed to the certification's *current* expires_on, not just
    its id -- so renewing (which moves expires_on forward) naturally opens up
    a fresh reminder for the next cycle, rather than being permanently
    silenced by the first one ever sent.
    """
    today = (now or utcnow()).date()
    certifications = session.exec(
        select(Certification).where(
            Certification.renewal_required.is_(True),
            Certification.expires_on.is_not(None),
            Certification.status == "active",
        )
    ).all()

    queued = 0
    for certification in certifications:
        reminder_date = certification.expires_on - timedelta(days=certification.reminder_days_before)
        if today < reminder_date:
            continue
        queue(
            session,
            user_id=certification.user_id,
            kind="certification_renewal",
            payload={
                "certification_id": certification.id,
                "name": certification.name,
                "issuing_organization": certification.issuing_organization,
                "expires_on": certification.expires_on.isoformat(),
            },
            dedupe_key=f"certification_renewal:{certification.id}:{certification.expires_on.isoformat()}",
        )
        queued += 1
    return queued
