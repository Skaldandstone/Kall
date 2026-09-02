"""Queue a reminder once a growth milestone's target date enters its window.

GrowthMilestone.target_date was set by the deterministic and AI plan
generators, and rendered in the growth workspace, but nothing anywhere ever
read it back for a reminder -- the exact gap already found and fixed once
for Certification.expires_on (see certification_reminders.py). Unlike a
certification, a milestone has no per-row reminder_days_before to configure,
so a single fixed window is used instead.

The same missing piece this uncovered -- nothing ever wrote to
GrowthMilestone.status or completed_at, so a milestone could never actually
be marked done -- is fixed separately in api_growth.py's
update_milestone_status(). Excluding "completed" here only means something
because that now exists.
"""

from datetime import datetime, timedelta

from kall.clock import utcnow
from kall.models import GrowthMilestone
from kall.services.notification_delivery import queue
from sqlmodel import Session, select

#: Not user-configurable, unlike Certification.reminder_days_before -- a
#: milestone has no equivalent per-row setting, and a week's notice is a
#: reasonable single default for a self-directed learning plan.
REMINDER_DAYS_BEFORE = 7


def queue_growth_milestone_reminders(session: Session, *, now: datetime | None = None) -> int:
    """Queue one `growth_milestone_reminder` delivery per milestone that has
    just entered its reminder window. Returns the number queued.

    dedupe_key is keyed to the milestone's *current* target_date, not just
    its id -- so regenerating a plan (which can shift target dates) or
    editing one directly naturally opens a fresh reminder rather than being
    permanently silenced by the first one ever sent for that id.
    """
    today = (now or utcnow()).date()
    milestones = session.exec(
        select(GrowthMilestone).where(
            GrowthMilestone.status != "completed",
            GrowthMilestone.target_date.is_not(None),
        )
    ).all()

    queued = 0
    for milestone in milestones:
        reminder_date = milestone.target_date - timedelta(days=REMINDER_DAYS_BEFORE)
        if today < reminder_date:
            continue
        queue(
            session,
            user_id=milestone.user_id,
            kind="growth_milestone_reminder",
            payload={
                "milestone_id": milestone.id,
                "title": milestone.title,
                "phase": milestone.phase,
                "target_date": milestone.target_date.isoformat(),
            },
            dedupe_key=f"growth_milestone_reminder:{milestone.id}:{milestone.target_date.isoformat()}",
        )
        queued += 1
    return queued
