"""Legacy schedule cadence with atomic claims and durable posting-change alerts."""

import logging
from datetime import datetime

from kall.models import CareerProfile, DiscoverySchedule, Job, User
from kall.services import work_claims
from kall.services.discovery import run_discovery
from kall.services.opportunities import advance_schedule, due_schedule, material_fingerprint
from kall.services.opportunity_notifications import (
    eligible_opportunities,
    prepare_deliveries,
    record_event,
)
from sqlmodel import Session, select

logger = logging.getLogger(__name__)


async def run_due_schedules(session: Session, *, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.utcnow()
    due = [row for row in session.exec(select(DiscoverySchedule).where(DiscoverySchedule.enabled))
           if due_schedule(row, now)]
    ran = errors = 0
    for schedule in due:
        key = f"discovery-schedule:{schedule.id}"
        token = work_claims.acquire(session, key, now, seconds=600, user_id=schedule.user_id)
        if not token:
            continue
        try:
            session.refresh(schedule)
            if not due_schedule(schedule, now):
                continue
            user = session.get(User, schedule.user_id)
            profile = session.get(CareerProfile, schedule.professional_profile_id)
            if not user or not profile:
                schedule.enabled = False
                session.add(schedule)
                session.commit()
                continue
            if not user.is_active or not profile.is_active or profile.user_id != user.id:
                continue
            schedule.running_since = now
            session.add(schedule)
            session.commit()
            try:
                run = await run_discovery(session, user, profile, max_posting_age_days=schedule.max_posting_age_days)
                ran += 1
                schedule.last_error = "; ".join(run.errors) if run and run.errors else None
                if not schedule.last_error:
                    schedule.last_success_at = now
            except Exception:
                errors += 1
                schedule.last_error = "Discovery failed; next scheduled run will retry."
                logger.warning("Discovery failed for schedule %s", schedule.id, exc_info=True)
            finally:
                advance_schedule(schedule, now)
                session.add(schedule)
                session.commit()
            for opportunity in eligible_opportunities(session, user.id):
                if opportunity.professional_profile_id == profile.id:
                    job = session.get(Job, opportunity.job_id)
                    record_event(session, user.id, job.id, material_fingerprint(job))
            session.commit()
        finally:
            work_claims.release(session, key, token)
    return {"ran": ran, "errors": errors, "digests_queued": prepare_deliveries(session, now=now)}
