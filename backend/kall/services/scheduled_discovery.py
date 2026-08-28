"""Actually running the schedules DiscoverySchedule describes.

The model (`DiscoverySchedule`), the due-check (`due_schedule`), the
advance-to-next-run logic (`advance_schedule`), and the search itself
(`run_discovery`) all existed. Nothing ever called them together -- the only
caller of `run_discovery` anywhere in the codebase was the manual "search
now" endpoint. A schedule someone created sat there forever, `enabled=True`,
never actually running, with the frontend's own "Next automatic run: Pending
scheduler" copy already admitting as much.

This is that missing piece: find every schedule that is due right now,
run it, and queue a digest of whatever came back marked "new" -- reusing
the exact same outbox everything else in services/notification_delivery.py
writes into.
"""

import logging
from datetime import datetime

from kall.models import CareerProfile, DiscoverySchedule, NotificationPreference, Opportunity, User
from kall.services.discovery import run_discovery
from kall.services.opportunities import advance_schedule, due_schedule, queue_digest
from sqlmodel import Session, select

logger = logging.getLogger(__name__)


async def run_due_schedules(session: Session, *, now: datetime | None = None) -> dict[str, int]:
    """Run every schedule that is due, and queue a digest for what it found.

    `running_since` is set before the search starts and cleared by
    `advance_schedule` afterward -- the same lock `due_schedule` already
    checked without anything ever acquiring it. Without this, two
    overlapping invocations (a slow search plus an impatient retry) could
    run the same schedule twice concurrently.
    """
    now = now or datetime.utcnow()
    due = [
        schedule
        for schedule in session.exec(select(DiscoverySchedule).where(DiscoverySchedule.enabled))
        if due_schedule(schedule, now)
    ]

    ran = errors = digests_queued = 0
    for schedule in due:
        schedule.running_since = now
        session.add(schedule)
        session.commit()

        user = session.get(User, schedule.user_id)
        profile = session.get(CareerProfile, schedule.professional_profile_id)
        if not user or not profile:
            # The account or the profile it targeted is gone. Nothing to run,
            # and nothing worth retrying hourly forever -- turn it off rather
            # than leaving a permanently-due, permanently-failing schedule.
            schedule.enabled = False
            advance_schedule(schedule, now)
            session.add(schedule)
            session.commit()
            continue

        try:
            await run_discovery(session, user, profile)
            ran += 1
        except Exception:
            errors += 1
            logger.warning("Discovery run failed for schedule %s", schedule.id, exc_info=True)
        finally:
            advance_schedule(schedule, now)
            session.add(schedule)
            session.commit()

        # "new" is the model's own resting state for something nobody has
        # acted on yet -- reviewed, saved, dismissed, or applied to all move
        # it elsewhere. Querying by that, rather than trying to track exactly
        # which rows this one run touched, is also what correctly re-surfaces
        # a previously-dismissed posting that materially changed (see
        # upsert_opportunity), which does belong in the next digest.
        #
        # minimum_match_score is the settings page's own promise ("only
        # matches at or above this score are worth an email") -- queuing
        # every "new" row regardless of score, as this used to, emailed
        # someone a digest of a job they explicitly said wasn't a good
        # enough match. No preference row uses the model's own default (60),
        # same convention queue_daily_briefs already uses.
        preference = session.exec(
            select(NotificationPreference).where(NotificationPreference.user_id == user.id)
        ).first()
        minimum_score = preference.minimum_match_score if preference else NotificationPreference.model_fields["minimum_match_score"].default
        new_ids = list(
            session.exec(
                select(Opportunity.id).where(
                    Opportunity.user_id == user.id,
                    Opportunity.professional_profile_id == profile.id,
                    Opportunity.state == "new",
                    Opportunity.match_score >= minimum_score,
                )
            )
        )
        if new_ids:
            queue_digest(session, user.id, new_ids)
            digests_queued += 1

    return {"ran": ran, "errors": errors, "digests_queued": digests_queued}
