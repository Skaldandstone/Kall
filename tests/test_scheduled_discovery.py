"""run_due_schedules: the missing piece tying DiscoverySchedule, due_schedule,
run_discovery, and the notification outbox together. Each of those existed
and was tested in isolation; nothing had ever proven they work as a whole.
"""

import pytest
from kall.models import (
    CareerProfile,
    DiscoverySchedule,
    NotificationDelivery,
    NotificationPreference,
    Opportunity,
    SearchSource,
    User,
)
from kall.providers.jobs import DiscoveredJob
from kall.services.scheduled_discovery import run_due_schedules
from sqlmodel import Session, select


class _FakeProvider:
    async def collect(self, company_name: str, board_key: str) -> list[DiscoveredJob]:
        return [
            DiscoveredJob(
                source="greenhouse", external_id="1", company=company_name,
                title="Senior Environment Artist",
                description="Build worlds with Unreal Engine for our games studio.",
                url="https://example.test/scheduled-job/1", location="Remote",
            )
        ]


def _setup(session, monkeypatch, *, run_at_hour=8, timezone="UTC", cadence="daily"):
    from datetime import time as time_

    monkeypatch.setitem(__import__("kall.services.discovery", fromlist=["PROVIDERS"]).PROVIDERS, "greenhouse", _FakeProvider)

    user = User(clerk_user_id="user_scheduled", email="scheduled@example.com", full_name="Scheduled Test")
    session.add(user)
    session.commit()
    session.refresh(user)

    # Deliberately a strong match (score 70) against _FakeProvider's job --
    # comfortably above NotificationPreference's default minimum_match_score
    # (60), so these tests exercise the "definitely worth a digest" case.
    # See test_a_low_scoring_match_does_not_queue_a_digest for the opposite.
    profile = CareerProfile(
        user_id=user.id, name="Game Art", target_titles=["Environment Artist"],
        industries=["Games"], include_keywords=["Unreal Engine", "worlds"],
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)

    session.add(SearchSource(user_id=user.id, provider="greenhouse", company_name="Example Games", board_key="example"))
    schedule = DiscoverySchedule(
        user_id=user.id, professional_profile_id=profile.id,
        run_at_local=time_(run_at_hour, 0), timezone=timezone, cadence=cadence,
    )
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return user, profile, schedule


@pytest.mark.asyncio
async def test_a_due_schedule_actually_runs_and_populates_opportunities(engine, monkeypatch) -> None:
    from datetime import datetime

    with Session(engine) as session:
        user, profile, schedule = _setup(session, monkeypatch)

        result = await run_due_schedules(session, now=datetime(2026, 8, 27, 8, 0))

        assert result["ran"] == 1
        assert result["digests_queued"] == 1
        opportunities = list(session.exec(select(Opportunity).where(Opportunity.user_id == user.id)))
        assert len(opportunities) == 1
        assert opportunities[0].state == "new"


@pytest.mark.asyncio
async def test_a_schedule_outside_its_hour_is_left_alone(engine, monkeypatch) -> None:
    from datetime import datetime

    with Session(engine) as session:
        _setup(session, monkeypatch)
        result = await run_due_schedules(session, now=datetime(2026, 8, 27, 14, 0))
        assert result == {"ran": 0, "errors": 0, "digests_queued": 0}


@pytest.mark.asyncio
async def test_running_it_advances_the_schedule_so_it_does_not_run_again_immediately(engine, monkeypatch) -> None:
    from datetime import datetime

    with Session(engine) as session:
        _, _, schedule_id = (lambda u, p, s: (u, p, s.id))(*_setup(session, monkeypatch))
        await run_due_schedules(session, now=datetime(2026, 8, 27, 8, 0))

    with Session(engine) as session:
        schedule = session.get(DiscoverySchedule, schedule_id)
        assert schedule.running_since is None, "the lock must be released after the run"
        assert schedule.last_run_at is not None


@pytest.mark.asyncio
async def test_a_real_digest_is_queued_in_the_notification_outbox(engine, monkeypatch) -> None:
    from datetime import datetime

    with Session(engine) as session:
        user, _, _ = _setup(session, monkeypatch)
        await run_due_schedules(session, now=datetime(2026, 8, 27, 8, 0))

        delivery = session.exec(
            select(NotificationDelivery).where(NotificationDelivery.user_id == user.id)
        ).one()
        assert delivery.kind == "opportunity_digest"
        assert delivery.status == "queued"
        assert len(delivery.payload["opportunity_ids"]) == 1


@pytest.mark.asyncio
async def test_a_match_below_the_minimum_score_does_not_queue_a_digest(engine, monkeypatch) -> None:
    """The settings page's own promise ("only matches at or above this score
    are worth an email") was never actually enforced here -- every "new"
    opportunity was queued regardless of score. The fixture scores 70; a
    preference requiring 95+ must leave it out of the digest even though
    the run itself still succeeds."""
    from datetime import datetime

    with Session(engine) as session:
        user, profile, _ = _setup(session, monkeypatch)
        session.add(NotificationPreference(user_id=user.id, minimum_match_score=95))
        session.commit()

        result = await run_due_schedules(session, now=datetime(2026, 8, 27, 8, 0))

        assert result["ran"] == 1
        assert result["digests_queued"] == 0
        opportunities = list(session.exec(select(Opportunity).where(Opportunity.user_id == user.id)))
        assert len(opportunities) == 1, "the opportunity itself is still tracked, just not emailed"
        assert not list(session.exec(select(NotificationDelivery).where(NotificationDelivery.user_id == user.id)))


@pytest.mark.asyncio
async def test_a_custom_minimum_score_below_the_match_still_queues_a_digest(engine, monkeypatch) -> None:
    from datetime import datetime

    with Session(engine) as session:
        user, profile, _ = _setup(session, monkeypatch)
        session.add(NotificationPreference(user_id=user.id, minimum_match_score=40))
        session.commit()

        result = await run_due_schedules(session, now=datetime(2026, 8, 27, 8, 0))
        assert result["digests_queued"] == 1


@pytest.mark.asyncio
async def test_a_disabled_schedule_never_runs(engine, monkeypatch) -> None:
    from datetime import datetime

    with Session(engine) as session:
        _, _, schedule = _setup(session, monkeypatch)
        schedule.enabled = False
        session.add(schedule)
        session.commit()

        result = await run_due_schedules(session, now=datetime(2026, 8, 27, 8, 0))
        assert result["ran"] == 0


@pytest.mark.asyncio
async def test_a_schedule_pointing_at_a_deleted_profile_is_turned_off_not_retried_forever(engine, monkeypatch) -> None:
    from datetime import datetime

    with Session(engine) as session:
        user, profile, schedule = _setup(session, monkeypatch)
        session.delete(profile)
        session.commit()
        schedule_id = schedule.id

        result = await run_due_schedules(session, now=datetime(2026, 8, 27, 8, 0))
        assert result["ran"] == 0
        assert result["errors"] == 0

    with Session(engine) as session:
        schedule = session.get(DiscoverySchedule, schedule_id)
        assert schedule.enabled is False, "a permanently-broken schedule must not stay due forever"
