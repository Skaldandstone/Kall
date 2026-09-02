from datetime import datetime, timedelta

import pytest
from kall.clock import utcnow
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
    schedule = DiscoverySchedule(user_id=1, professional_profile_id=1, next_run_at=utcnow() - timedelta(hours=1), running_since=utcnow())
    assert due_schedule(schedule, utcnow()) is False


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


@pytest.mark.asyncio
async def test_run_discovery_records_the_actual_query_it_searched_for(monkeypatch: pytest.MonkeyPatch) -> None:
    """build_ats_queries() was called but its return value discarded, so
    "ATS Search records the broader hidden-market query in run history" was
    only a comment -- run history showed the provider name and nothing else.
    """
    monkeypatch.setitem(__import__("kall.services.discovery", fromlist=["PROVIDERS"]).PROVIDERS, "greenhouse", _FakeProvider)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="query@example.com", full_name="Query Test", hashed_password="x")
        session.add(user)
        session.commit()
        session.refresh(user)

        profile = CareerProfile(user_id=user.id, name="Game Art", target_titles=["Environment Artist"])
        session.add(profile)
        session.commit()
        session.refresh(profile)

        run = await run_discovery(session, user, profile)

        assert run.ats_search_query
        assert "Environment Artist" in run.ats_search_query
        assert "site:boards.greenhouse.io" in run.ats_search_query


def test_a_schedule_is_not_due_outside_its_chosen_hour() -> None:
    """run_at_local was stored and never actually consulted -- a schedule
    used to be "due" the instant it was created, regardless of the hour
    someone picked. This is the case that used to be silently wrong."""
    from datetime import time as time_

    from kall.services.opportunities import due_schedule

    schedule = DiscoverySchedule(
        user_id=1, professional_profile_id=1, run_at_local=time_(8, 0), timezone="UTC",
    )
    assert due_schedule(schedule, datetime(2026, 8, 27, 14, 0)) is False
    assert due_schedule(schedule, datetime(2026, 8, 27, 8, 0)) is True


def test_a_freshly_created_schedule_waits_for_its_first_matching_hour() -> None:
    """last_run_at is None means it has never run -- that alone must not
    make it due at any hour; it still waits for run_at_local."""
    from datetime import time as time_

    from kall.services.opportunities import due_schedule

    schedule = DiscoverySchedule(
        user_id=1, professional_profile_id=1, run_at_local=time_(8, 0), timezone="UTC",
    )
    assert schedule.last_run_at is None
    assert due_schedule(schedule, datetime(2026, 8, 27, 20, 0)) is False


def test_a_daily_schedule_does_not_run_twice_on_the_same_matching_hour() -> None:
    from datetime import time as time_

    from kall.services.opportunities import due_schedule

    schedule = DiscoverySchedule(
        user_id=1, professional_profile_id=1, run_at_local=time_(8, 0), timezone="UTC",
        last_run_at=datetime(2026, 8, 27, 8, 0),
    )
    # A few hours later the same day, hour no longer matches anyway --
    # the real guard is the day that follows, checked below.
    assert due_schedule(schedule, datetime(2026, 8, 27, 14, 0)) is False
    # Next day, same hour: due again.
    assert due_schedule(schedule, datetime(2026, 8, 28, 8, 0)) is True


def test_a_weekday_only_schedule_skips_the_weekend() -> None:
    from datetime import time as time_

    from kall.services.opportunities import due_schedule

    schedule = DiscoverySchedule(
        user_id=1, professional_profile_id=1, run_at_local=time_(8, 0), timezone="UTC",
        cadence="weekdays",
    )
    # 2026-08-29 is a Saturday.
    assert due_schedule(schedule, datetime(2026, 8, 29, 8, 0)) is False
    # 2026-08-31 is a Monday.
    assert due_schedule(schedule, datetime(2026, 8, 31, 8, 0)) is True


def test_a_timezone_shifts_which_utc_hour_counts_as_due() -> None:
    """The whole point: two schedules both asking for 8am should not run at
    the same UTC instant if they are in different timezones."""
    from datetime import time as time_

    from kall.services.opportunities import due_schedule

    pacific = DiscoverySchedule(
        user_id=1, professional_profile_id=1, run_at_local=time_(8, 0), timezone="America/Los_Angeles",
    )
    # 8am Pacific in August (UTC-7) is 15:00 UTC.
    assert due_schedule(pacific, datetime(2026, 8, 27, 8, 0)) is False
    assert due_schedule(pacific, datetime(2026, 8, 27, 15, 0)) is True


def test_advance_schedule_clears_the_lock_and_estimates_a_sensible_next_run() -> None:
    from datetime import time as time_

    from kall.services.opportunities import advance_schedule

    schedule = DiscoverySchedule(
        user_id=1, professional_profile_id=1, run_at_local=time_(8, 0), timezone="UTC",
        running_since=datetime(2026, 8, 27, 8, 0),
    )
    now = datetime(2026, 8, 27, 8, 3)
    advance_schedule(schedule, now)

    assert schedule.running_since is None
    assert schedule.last_run_at == now
    assert schedule.next_run_at == datetime(2026, 8, 28, 8, 0)
