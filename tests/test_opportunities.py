from datetime import datetime, timedelta

import pytest
from kall.models import CareerProfile, DiscoverySchedule, Job, Opportunity, SearchSource, User
from kall.providers.jobs import DiscoveredJob
from kall.services.discovery import run_discovery
from kall.services.opportunities import (
    canonical_key,
    due_schedule,
    mark_state,
    material_fingerprint,
)
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select


def sample_job() -> Job:
    return Job(source="greenhouse", company="Example Games", title="Senior Environment Artist", description="Build worlds with Unreal Engine.", url="https://example.test/job/1", location="Remote")


def test_canonical_key_is_stable_across_formatting() -> None:
    first = sample_job()
    second = sample_job()
    second.company = " Example   Games "
    second.title = "Senior-Environment Artist"
    assert canonical_key(first) == canonical_key(second)


def test_material_change_changes_fingerprint() -> None:
    job = sample_job()
    before = material_fingerprint(job)
    job.description += " Lead a team."
    assert material_fingerprint(job) != before


def test_dismissal_records_fingerprint() -> None:
    row = Opportunity(user_id=1, professional_profile_id=1, job_id=1, canonical_key="key", material_fingerprint="fingerprint")
    mark_state(row, "not_interested")
    assert row.state == "not_interested"
    assert row.dismissed_fingerprint == "fingerprint"


def test_running_schedule_is_not_due() -> None:
    schedule = DiscoverySchedule(user_id=1, professional_profile_id=1, next_run_at=datetime.utcnow() - timedelta(hours=1), running_since=datetime.utcnow())
    assert due_schedule(schedule, datetime.utcnow()) is False


class _FakeProvider:
    """Stands in for a real ATS provider so run_discovery can be exercised
    without a network call, matching greenhouse/lever/ashby's collect() shape.
    """

    def __init__(self) -> None:
        pass

    async def collect(self, company_name: str, board_key: str) -> list[DiscoveredJob]:
        return [
            DiscoveredJob(
                source="greenhouse",
                external_id="1",
                company=company_name,
                title="Senior Environment Artist",
                description="Build worlds with Unreal Engine.",
                url="https://example.test/job/1",
                location="Remote",
            )
        ]


@pytest.mark.asyncio
async def test_run_discovery_populates_the_tracked_opportunity_inbox(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression test: run_discovery created JobMatch rows but never called
    upsert_opportunity, so the save/reviewing/apply/dismiss inbox (GET
    /opportunities) had no way to ever be populated from a real search.
    """
    monkeypatch.setitem(__import__("kall.services.discovery", fromlist=["PROVIDERS"]).PROVIDERS, "greenhouse", _FakeProvider)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="discovery@example.com", full_name="Discovery Test", hashed_password="x")
        session.add(user)
        session.commit()
        session.refresh(user)

        profile = CareerProfile(user_id=user.id, name="Game Art", target_titles=["Environment Artist"])
        session.add(profile)
        session.commit()
        session.refresh(profile)

        source = SearchSource(user_id=user.id, provider="greenhouse", company_name="Example Games", board_key="example")
        session.add(source)
        session.commit()

        run = await run_discovery(session, user, profile)

        assert run.matches_created == 1
        opportunities = list(session.exec(select(Opportunity).where(Opportunity.user_id == user.id)))
        assert len(opportunities) == 1
        assert opportunities[0].state == "new"
        assert opportunities[0].match_score > 0

        # Running discovery again with the same job present must not duplicate
        # the opportunity row, only refresh it.
        await run_discovery(session, user, profile)
        opportunities_after = list(session.exec(select(Opportunity).where(Opportunity.user_id == user.id)))
        assert len(opportunities_after) == 1
