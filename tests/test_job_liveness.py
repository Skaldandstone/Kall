"""The /applications pipeline had no way to know a tracked posting had been
taken down after someone applied -- Job had no liveness concept at all.
recheck_tracked_job_postings only ever flags a job as gone on a real
404/410; anything else (timeouts, 403s, network errors) is inconclusive and
must never flip is_still_posted, since a posting is innocent until proven
gone.
"""

from datetime import timedelta

import httpx
import pytest
from kall.clock import utcnow
from kall.models import Application, CareerProfile, Job, User
from kall.models.enums import ApplicationStatus
from kall.services import job_liveness
from sqlmodel import Session, select


def _tracked_job(session: Session, url: str, **overrides) -> Job:
    user = User(clerk_user_id=f"user_{url}", email=f"{url}@example.com", full_name="Test")
    session.add(user)
    session.commit()
    session.refresh(user)
    job = Job(source="test", company="Acme", title="Engineer", description="d", url=url)
    for key, value in overrides.items():
        setattr(job, key, value)
    session.add(job)
    profile = CareerProfile(user_id=user.id, name="Backend")
    session.add(profile)
    session.commit()
    session.refresh(job)
    session.refresh(profile)
    session.add(Application(
        user_id=user.id, job_id=job.id, career_profile_id=profile.id,
        status=ApplicationStatus.REVIEW_REQUIRED,
    ))
    session.commit()
    session.refresh(job)
    return job


@pytest.mark.asyncio
async def test_a_404_flags_the_job_as_no_longer_posted(engine) -> None:
    with Session(engine) as session:
        job = _tracked_job(session, "https://boards.example.com/gone")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404)

        async def fake_recheck() -> dict:
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=15) as client:
                live = await job_liveness._check_one(client, job.url)
            return live

        live = await fake_recheck()
        assert live is False


@pytest.mark.asyncio
async def test_a_network_error_is_inconclusive_and_never_flags_the_job() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=15) as client:
        live = await job_liveness._check_one(client, "https://boards.example.com/x")
    assert live is None


@pytest.mark.asyncio
async def test_a_403_is_inconclusive_not_a_confirmed_removal() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=15) as client:
        live = await job_liveness._check_one(client, "https://boards.example.com/x")
    assert live is None


def test_jobs_to_check_skips_withdrawn_applications(engine) -> None:
    with Session(engine) as session:
        job = _tracked_job(session, "https://boards.example.com/withdrawn")
        application = session.exec(
            select(Application).where(Application.job_id == job.id)
        ).first()
        application.status = ApplicationStatus.WITHDRAWN
        session.add(application)
        session.commit()

        due = job_liveness._jobs_to_check(session, utcnow() + timedelta(hours=1))
        assert job.id not in {row.id for row in due}


def test_jobs_to_check_skips_ones_checked_recently(engine) -> None:
    with Session(engine) as session:
        job = _tracked_job(
            session, "https://boards.example.com/recent",
            liveness_checked_at=utcnow(),
        )
        due = job_liveness._jobs_to_check(session, utcnow() - timedelta(hours=1))
        assert job.id not in {row.id for row in due}


def test_recheck_tracked_job_postings_updates_status_and_timestamp(engine, monkeypatch: pytest.MonkeyPatch) -> None:
    with Session(engine) as session:
        job = _tracked_job(session, "https://boards.example.com/recheck-me")
        job_id = job.id

    async def fake_check_one(client, url):
        return False

    monkeypatch.setattr(job_liveness, "_check_one", fake_check_one)

    with Session(engine) as session:
        result = job_liveness.recheck_tracked_job_postings(session)
    assert result == {"checked": 1, "newly_flagged": 1}
    with Session(engine) as session:
        refreshed = session.get(Job, job_id)
        assert refreshed.is_still_posted is False
        assert refreshed.liveness_checked_at is not None
