"""Source identity is stable even when an opportunity changes representative."""
from datetime import datetime

from kall.models import CareerProfile, Job, JobMatch, Opportunity
from kall.services.matching import is_out_of_scope
from kall.services.suppression import DISCOVERY_BLOCKING_REASONS, is_suppressed, suppressed_urls
from sqlmodel import Session, select


def opportunity_ids_by_source(
    session: Session,
    *,
    user_id: int,
    professional_profile_id: int,
) -> tuple[dict[int, int], dict[str, int]]:
    """Map every known source job to its owned canonical opportunity.

    New source records carry a stable job ID. The URL map keeps older rows
    usable until normal discovery traffic repairs those legacy records.
    """
    by_job_id: dict[int, int] = {}
    by_url: dict[str, int] = {}
    rows = session.exec(
        select(Opportunity)
        .where(
            Opportunity.user_id == user_id,
            Opportunity.professional_profile_id == professional_profile_id,
        )
        .order_by(Opportunity.id)
    )
    for row in rows:
        if row.id is None:
            continue
        by_job_id.setdefault(row.job_id, row.id)
        for record in row.source_records or []:
            job_id = record.get("job_id")
            url = record.get("url")
            if isinstance(job_id, int):
                by_job_id.setdefault(job_id, row.id)
            elif isinstance(url, str) and url:
                by_url.setdefault(url, row.id)
    return by_job_id, by_url


def source_jobs(session: Session, row: Opportunity) -> list[Job]:
    """Resolve additive job IDs and legacy URL-only records without global criteria."""
    jobs = {}
    representative = session.get(Job, row.job_id)
    if representative:
        jobs[representative.id] = representative
    for record in row.source_records or []:
        job = session.get(Job, record["job_id"]) if record.get("job_id") else None
        if job is None and record.get("url"):
            job = session.exec(select(Job).where(Job.url == record["url"])).first()
        if job:
            jobs[job.id] = job
    return sorted(jobs.values(), key=lambda job: job.id)


def belongs_to_source(session: Session, row: Opportunity, job: Job) -> bool:
    return row.job_id == job.id or any(
        item.get("job_id") == job.id or (not item.get("job_id") and item.get("url") == job.url)
        for item in row.source_records or []
    )


def source_match(session: Session, row: Opportunity, job: Job) -> JobMatch | None:
    return session.exec(select(JobMatch).where(
        JobMatch.user_id == row.user_id, JobMatch.career_profile_id == row.professional_profile_id,
        JobMatch.job_id == job.id,
    )).first()


def refresh_representative(session: Session, row: Opportunity) -> list[tuple[Job, int]]:
    """Keep job, score and fingerprint together, leaving workflow/history intact.

    A legacy representative without a JobMatch keeps its own stored score. A
    different source must have this user's/profile's evidence to represent it.
    Ties retain the current representative, then prefer the lowest stable ID.
    """
    from kall.services.opportunities import material_fingerprint

    profile = session.get(CareerProfile, row.professional_profile_id)
    if not profile or profile.user_id != row.user_id:
        return []
    blocked = suppressed_urls(session, row.user_id, reasons=DISCOVERY_BLOCKING_REASONS)
    candidates = []
    for job in source_jobs(session, row):
        match = source_match(session, row, job)
        score = match.score if match else row.match_score if job.id == row.job_id else None
        if score is not None and not is_out_of_scope(job, profile) and not is_suppressed(job.url, blocked):
            candidates.append((job, score))
    if candidates:
        job, score = max(candidates, key=lambda pair: (pair[1], pair[0].id == row.job_id, -pair[0].id))
        fingerprint = material_fingerprint(job)
        if (row.job_id, row.match_score, row.material_fingerprint) != (job.id, score, fingerprint):
            row.job_id, row.match_score, row.material_fingerprint = job.id, score, fingerprint
            row.updated_at = datetime.utcnow()
            session.add(row)
    elif row.match_score:
        row.match_score = 0
        row.updated_at = datetime.utcnow()
        session.add(row)
    return candidates
