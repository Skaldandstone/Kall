"""Re-checks whether a tracked application's job posting is still live.

Kept separate from services/discovery.py -- that module finds new postings;
this one only re-verifies postings a person already has an Application
against, so the pipeline at /applications stays accurate instead of quietly
going stale once a listing is taken down.
"""

import asyncio
from datetime import datetime, timedelta

import httpx
from kall.clock import utcnow
from kall.models import Application, Job
from kall.models.enums import ApplicationStatus
from sqlmodel import Session, select

_CONCURRENCY = 10
#: The daily job runs roughly every 24h; 20h leaves slack for a slightly
#: early or late run without skipping a job for a whole extra day.
_RECHECK_INTERVAL_HOURS = 20
_DEAD_STATUS_CODES = {404, 410}


async def _check_one(client: httpx.AsyncClient, url: str) -> bool | None:
    """True = still live, False = confirmed gone, None = inconclusive.

    Inconclusive results (network errors, timeouts, a site returning 403 to
    a bot) never flip is_still_posted -- only a real 404/410 does. A posting
    is innocent until proven gone.
    """
    try:
        response = await client.get(url, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if response.status_code in _DEAD_STATUS_CODES:
        return False
    if response.status_code >= 400:
        return None
    return True


def _jobs_to_check(session: Session, checked_before: datetime) -> list[Job]:
    tracked_job_ids = list(
        session.exec(
            select(Application.job_id).where(Application.status != ApplicationStatus.WITHDRAWN)
        )
    )
    if not tracked_job_ids:
        return []
    return list(
        session.exec(
            select(Job).where(
                Job.id.in_(tracked_job_ids),
                (Job.liveness_checked_at.is_(None)) | (Job.liveness_checked_at < checked_before),
            )
        )
    )


async def _recheck(session: Session) -> dict[str, int]:
    cutoff = utcnow() - timedelta(hours=_RECHECK_INTERVAL_HOURS)
    jobs = _jobs_to_check(session, cutoff)
    if not jobs:
        return {"checked": 0, "newly_flagged": 0}

    semaphore = asyncio.Semaphore(_CONCURRENCY)

    async def bounded(client: httpx.AsyncClient, job: Job) -> tuple[Job, bool | None]:
        async with semaphore:
            return job, await _check_one(client, job.url)

    async with httpx.AsyncClient(timeout=15) as client:
        results = await asyncio.gather(*(bounded(client, job) for job in jobs))

    checked = 0
    newly_flagged = 0
    for job, live in results:
        if live is None:
            continue
        checked += 1
        job.liveness_checked_at = utcnow()
        if not live and job.is_still_posted:
            newly_flagged += 1
        job.is_still_posted = live
        session.add(job)
    session.commit()
    return {"checked": checked, "newly_flagged": newly_flagged}


def recheck_tracked_job_postings(session: Session) -> dict[str, int]:
    return asyncio.run(_recheck(session))
