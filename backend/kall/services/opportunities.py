import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timedelta

from kall.models import (
    CareerGoal,
    DiscoverySchedule,
    GrowthMarketSignal,
    Job,
    JobRequirementAnalysis,
    NotificationDelivery,
    Opportunity,
)
from kall.services.posting_evidence import visible_department_names
from kall.services.scheduling import local_hour, local_weekday, next_local_occurrence
from sqlmodel import Session, select


def normalize(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def canonical_key(job: Job) -> str:
    identity = "|".join([normalize(job.company), normalize(job.title), normalize(job.location)])
    return hashlib.sha256(identity.encode()).hexdigest()


def material_fingerprint(job: Job) -> str:
    content = "|".join([
        normalize(job.title), normalize(job.location), normalize(job.description),
        str(job.salary_min or ""), str(job.salary_max or ""), str(job.work_type or ""),
    ])
    names = visible_department_names(job.metadata_json)
    if names:
        content += "|" + json.dumps(names, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(content.encode()).hexdigest()


def upsert_opportunity(
    session: Session, *, user_id: int, profile_id: int, job: Job, match_score: int
) -> Opportunity:
    key = canonical_key(job)
    fingerprint = material_fingerprint(job)
    row = session.exec(select(Opportunity).where(
        Opportunity.user_id == user_id,
        Opportunity.professional_profile_id == profile_id,
        Opportunity.job_id == job.id,
    ).order_by(Opportunity.id)).first()
    if row is None:
        candidates = session.exec(select(Opportunity, Job).join(Job, Opportunity.job_id == Job.id).where(
            Opportunity.user_id == user_id,
            Opportunity.professional_profile_id == profile_id,
            Opportunity.canonical_key == key,
        ).order_by(Opportunity.id))
        # First-seen keys are only lookup hints after a posting edit. Verify
        # current company/title/location before adding another source, and
        # keep searching when an older candidate has a stale identity.
        row = next((candidate for candidate, current_job in candidates if canonical_key(current_job) == key), None)
    source = {"source": job.source, "external_id": job.external_id, "url": job.url}
    if row:
        row.last_seen_at = datetime.utcnow()
        row.match_score = match_score
        # Keep the first-seen cross-source identity. A title/location edit
        # must not collide with another tracked opportunity's canonical key
        # or merge two independent application histories.
        row.source_records = list({item.get("url"): item for item in [*row.source_records, source]}.values())
        # Posting edits and new matching evidence never undo a user's choice.
        row.material_fingerprint = fingerprint
    else:
        row = Opportunity(
            user_id=user_id, professional_profile_id=profile_id, job_id=job.id,
            canonical_key=key, material_fingerprint=fingerprint, match_score=match_score,
            source_records=[source],
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def mark_state(row: Opportunity, state: str) -> Opportunity:
    allowed = {"new", "saved", "reviewing", "apply", "not_interested", "archived"}
    if state not in allowed:
        raise ValueError("Unsupported opportunity state")
    row.state = state
    if state == "not_interested":
        row.dismissed_fingerprint = row.material_fingerprint
    return row


#: How much of a cadence's interval has to elapse before a schedule is due
#: again, expressed as a shortfall from the full interval. run_scheduled
#: discovery is meant to run roughly hourly, so a schedule due at exactly 24
#: hours could otherwise be skipped by up to an hour depending on tick
#: timing; allowing it to fire slightly early keeps "daily at 8am" actually
#: landing at 8am rather than drifting later each day.
_CADENCE_SLACK = timedelta(hours=2)


def due_schedule(schedule: DiscoverySchedule, now: datetime) -> bool:
    """Whether `schedule` should run right now.

    Gated on the account's actual chosen run_at_local/timezone -- those
    columns existed and were stored, but nothing ever read them for this
    decision. A schedule used to be "due" the moment next_run_at (computed
    with no awareness of run_at_local at all) passed, which meant "run daily
    at 8am" was never really true: the very first run happened immediately
    regardless of the hour, and every run after that landed at whatever time
    the scheduling job happened to have last ticked, not at 8am.
    """
    if not schedule.enabled or schedule.running_since:
        return False
    if local_hour(schedule.timezone, now) != schedule.run_at_local.hour:
        return False
    if schedule.cadence == "weekdays" and local_weekday(schedule.timezone, now) >= 5:
        return False
    if schedule.last_run_at is None:
        return True
    required = timedelta(days=7 if schedule.cadence == "weekly" else 1)
    return now - schedule.last_run_at >= required - _CADENCE_SLACK


def advance_schedule(schedule: DiscoverySchedule, now: datetime) -> None:
    schedule.last_run_at = now
    # For display only (DiscoveryTab's "Next automatic run") -- due_schedule
    # re-checks the real local hour on its own next tick rather than trusting
    # this value to the minute, so this only needs to be a good estimate.
    days_ahead = 7 if schedule.cadence == "weekly" else 1
    estimate = now + timedelta(days=days_ahead)
    if schedule.cadence == "weekdays":
        while estimate.weekday() >= 5:
            estimate += timedelta(days=1)
    schedule.next_run_at = next_local_occurrence(schedule.timezone, schedule.run_at_local.hour, estimate - timedelta(days=1))
    schedule.running_since = None


def queue_digest(session: Session, user_id: int, opportunity_ids: list[int]) -> NotificationDelivery:
    date_key = datetime.utcnow().date().isoformat()
    delivery = NotificationDelivery(
        user_id=user_id, channel="email", kind="opportunity_digest",
        dedupe_key=f"digest:{user_id}:{date_key}",
        payload={"opportunity_ids": opportunity_ids},
    )
    session.add(delivery)
    session.commit()
    session.refresh(delivery)
    return delivery


def analyze_growth_market(
    session: Session,
    goal: CareerGoal,
    analyses: list[JobRequirementAnalysis],
) -> GrowthMarketSignal:
    skills: Counter[str] = Counter()
    requirements: Counter[str] = Counter()
    for analysis in analyses:
        skills.update(item.lower() for item in analysis.required_skills + analysis.preferred_skills)
        requirements.update(item.lower() for item in analysis.explicit_requirements)
    signal = GrowthMarketSignal(
        user_id=goal.user_id, growth_goal_id=goal.id, observed_jobs=len(analyses),
        recurring_skills=[{"name": key, "count": count} for key, count in skills.most_common(12)],
        recurring_requirements=[{"text": key, "count": count} for key, count in requirements.most_common(12)],
        portfolio_signals=[f"Create evidence demonstrating {key}" for key, _ in skills.most_common(3)],
    )
    session.add(signal)
    session.commit()
    session.refresh(signal)
    return signal
