"""Queue a reminder once a work authorization's expiry enters its window.

WorkAuthorization.authorized_until is collected and consumed by autofill
(services/autofill.py), but nothing anywhere ever compared it against
today's date -- a visa or sponsorship could lapse silently with no warning
before an application went out using stale authorization data. The same
gap already found and fixed once for Certification.expires_on.

Unlike Certification, WorkAuthorization has no per-row reminder_days_before
to configure -- a single fixed window is used instead, longer than a
certification's typical default since visa/sponsorship renewals routinely
need lead time measured in months, not weeks.
"""

from datetime import datetime, timedelta

from kall.clock import utcnow
from kall.models import WorkAuthorization
from kall.services.notification_delivery import queue
from sqlmodel import Session, select

#: Not user-configurable, unlike Certification.reminder_days_before -- a
#: work authorization has no equivalent per-row setting. 60 days gives
#: realistic lead time for a visa or sponsorship renewal process.
REMINDER_DAYS_BEFORE = 60


def queue_work_authorization_reminders(session: Session, *, now: datetime | None = None) -> int:
    """Queue one `work_authorization_reminder` delivery per authorization
    that has just entered its reminder window. Returns the number queued.

    dedupe_key is keyed to the row's *current* authorized_until, not just
    its id -- so renewing (which moves the date forward) naturally opens a
    fresh reminder for the next cycle, rather than being permanently
    silenced by the first one ever sent.
    """
    today = (now or utcnow()).date()
    authorizations = session.exec(
        select(WorkAuthorization).where(WorkAuthorization.authorized_until.is_not(None))
    ).all()

    queued = 0
    for authorization in authorizations:
        reminder_date = authorization.authorized_until - timedelta(days=REMINDER_DAYS_BEFORE)
        if today < reminder_date:
            continue
        queue(
            session,
            user_id=authorization.user_id,
            kind="work_authorization_reminder",
            payload={
                "work_authorization_id": authorization.id,
                "country": authorization.country,
                "authorized_until": authorization.authorized_until.isoformat(),
            },
            dedupe_key=f"work_authorization_reminder:{authorization.id}:{authorization.authorized_until.isoformat()}",
        )
        queued += 1
    return queued
