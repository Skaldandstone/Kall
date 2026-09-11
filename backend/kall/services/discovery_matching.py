"""Shared, network-free ingestion and matching for discovery and cached feeds."""

from datetime import timedelta

from kall.clock import utcnow
from kall.models import CareerProfile, Job, JobMatch, Opportunity, User
from kall.providers.jobs import DiscoveredJob
from kall.services.matching import deterministic_match, is_out_of_scope
from kall.services.normalization import normalize_discovered
from kall.services.opportunities import upsert_opportunity
from kall.services.opportunity_sources import belongs_to_source, refresh_representative
from kall.services.suppression import DISCOVERY_BLOCKING_REASONS, is_suppressed, suppressed_urls
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select


def refresh_discovered_job_match(
    session: Session, *, user: User, profile: CareerProfile, job: Job
) -> JobMatch | None:
    """Refresh evidence and scores without changing any workflow state.

    An excluded historical match is retained with a zero score for its audit
    history, but is not returned as eligible. Callers must also apply current
    hard constraints when presenting stored matches or queuing notifications.
    """
    if profile.user_id != user.id:
        raise ValueError("The profile must belong to the current user")
    match = session.exec(select(JobMatch).where(
        JobMatch.user_id == user.id,
        JobMatch.career_profile_id == profile.id,
        JobMatch.job_id == job.id,
    )).first()
    reason = is_out_of_scope(job, profile)
    if reason and not match:
        return None
    score, strengths, gaps = (0, [], [reason]) if reason else deterministic_match(job, profile)
    if match is None:
        match = JobMatch(user_id=user.id, career_profile_id=profile.id, job_id=job.id)
    match.score = score
    match.strengths = strengths
    match.gaps = gaps
    match.recommendation = "pass" if reason else "apply" if score >= 75 else "review" if score >= 55 else "pass"
    match.updated_at = utcnow()
    session.add(match)
    for opportunity in session.exec(select(Opportunity).where(
        Opportunity.user_id == user.id,
        Opportunity.professional_profile_id == profile.id,
    )):
        if belongs_to_source(session, opportunity, job):
            refresh_representative(session, opportunity)
    session.flush()
    return None if reason else match


def _insert_or_reuse_job(session: Session, normalized: dict) -> tuple[Job, bool]:
    """Insert the posting, or adopt the row another run inserted first.

    Two discovery runs for the same account can overlap (a tap in the app
    while the monitoring schedule fires), and both pass the URL lookup
    before either commits. The unique index on job.url then rejects the
    second insert -- which used to surface as a 500 for the whole run
    (KALL-API-2). A savepoint keeps the failed insert from poisoning the
    session, and the row that won is used instead.
    """
    try:
        with session.begin_nested():
            job = Job(**normalized)
            session.add(job)
            session.flush()
        return job, True
    except IntegrityError:
        existing = session.exec(select(Job).where(Job.url == normalized["url"])).first()
        if existing is None:
            raise
        return existing, False


def ingest_discovered_jobs(
    session: Session,
    user: User,
    profile: CareerProfile,
    jobs: list[DiscoveredJob],
    *,
    max_posting_age_days: int | None = None,
    refresh_saved_matches: bool = True,
) -> dict:
    """Ingest already-fetched public postings. Does not call any provider.

    Returns counters plus eligible opportunity_ids for this batch. Commits
    stored rows, matching the existing discovery transaction boundary.
    """
    if profile.user_id != user.id:
        raise ValueError("The profile must belong to the current user")
    result = {"jobs_collected": len(jobs), "jobs_created": 0, "matches_created": 0,
              "jobs_skipped": 0, "opportunity_ids": []}
    cutoff = utcnow() - timedelta(days=max_posting_age_days) if max_posting_age_days else None
    blocked = suppressed_urls(session, user.id, reasons=DISCOVERY_BLOCKING_REASONS)
    # A profile edit must also refresh previously stored matches when a board
    # is empty, unavailable, or no longer returns a particular posting.
    if refresh_saved_matches:
        stored = session.exec(select(JobMatch, Job).join(Job, Job.id == JobMatch.job_id).where(
            JobMatch.user_id == user.id, JobMatch.career_profile_id == profile.id,
        )).all()
        for match, job in stored:
            if profile.updated_at > match.updated_at or job.updated_at > match.updated_at:
                refresh_discovered_job_match(session, user=user, profile=profile, job=job)
    for discovered in jobs:
        normalized = normalize_discovered(discovered)
        if is_suppressed(normalized["url"], blocked):
            result["jobs_skipped"] += 1
            continue
        job = session.exec(select(Job).where(Job.url == normalized["url"])).first()
        if job is None:
            job, created = _insert_or_reuse_job(session, normalized)
            if created:
                result["jobs_created"] += 1
        else:
            changed = False
            for key, value in normalized.items():
                if getattr(job, key) != value:
                    setattr(job, key, value)
                    changed = True
            if changed:
                job.updated_at = utcnow()
                session.add(job)
                session.flush()
        existed = session.exec(select(JobMatch.id).where(
            JobMatch.user_id == user.id, JobMatch.career_profile_id == profile.id,
            JobMatch.job_id == job.id,
        )).first() is not None
        if not existed and cutoff and job.posted_at and job.posted_at < cutoff:
            result["jobs_skipped"] += 1
            continue
        match = refresh_discovered_job_match(session, user=user, profile=profile, job=job)
        if match is None:
            result["jobs_skipped"] += 1
            continue
        result["matches_created"] += int(not existed)
        opportunity = upsert_opportunity(
            session, user_id=user.id, profile_id=profile.id, job=job, match_score=match.score,
        )
        if opportunity.id not in result["opportunity_ids"]:
            result["opportunity_ids"].append(opportunity.id)
    session.commit()
    return result
