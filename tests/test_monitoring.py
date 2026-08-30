"""Controlled public feeds and private observations. No external network or senders."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier
from types import SimpleNamespace

import httpx
import pytest
from kall.models import (
    CareerProfile,
    DiscoverySchedule,
    MonitoringLease,
    NotificationDelivery,
    NotificationPreference,
    Opportunity,
    OpportunityNotificationEvent,
    PublicBoardFeed,
    ScheduleBoardState,
    SearchSource,
    User,
)
from kall.providers.board_feed import feed_key, fetch_feed
from kall.services import monitoring, work_claims
from kall.services.opportunities import due_schedule
from sqlmodel import Session, SQLModel, create_engine, select

NOW = datetime(2026, 8, 30, 12)


@pytest.fixture(autouse=True)
def disabled_senders(monkeypatch):
    monkeypatch.setattr(
        monitoring, "get_settings", lambda: SimpleNamespace(monitoring_enabled=True)
    )
    from kall.services.notifications import NotificationService

    monkeypatch.setattr(
        NotificationService,
        "send_email",
        lambda *a, **k: pytest.fail("No live sender in feed tests"),
    )


def setup(session, suffix="one", boards=("alpha",)):
    user = User(clerk_user_id=suffix, email=f"{suffix}@example.test", full_name=suffix)
    session.add(user)
    session.flush()
    profile = CareerProfile(user_id=user.id, name=suffix, target_titles=["Engineer"])
    session.add(profile)
    session.flush()
    schedule = DiscoverySchedule(
        user_id=user.id, professional_profile_id=profile.id, cadence="continuous"
    )
    session.add(schedule)
    session.add(
        NotificationPreference(user_id=user.id, minimum_match_score=0, delivery_mode="immediate")
    )
    for board in boards:
        session.add(
            SearchSource(
                user_id=user.id, provider="greenhouse", company_name=board, board_key=board
            )
        )
    session.commit()
    return user, profile, schedule


def posting(number=1, title="Engineer"):
    return {
        "id": number,
        "title": title,
        "content": "Build Python software.",
        "absolute_url": f"https://jobs.example.test/{number}",
        "location": {"name": "Remote"},
    }


@pytest.mark.asyncio
async def test_shared_fetch_baseline_changes_and_user_isolation(engine):
    calls = []
    payload = {"jobs": [posting()]}

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=payload, headers={"etag": '"v1"'})

    with Session(engine) as session:
        user, _, _ = setup(session)
        other, profile, _ = setup(session, "two")
        profile.exclude_keywords = ["Engineer"]
        session.add(profile)
        session.commit()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await monitoring.run_monitoring(session, now=NOW, client=client)
            assert first["requests"] == 1 and first["profiles_checked"] == 2
            assert first["events_queued"] == 0
            assert list(session.exec(select(OpportunityNotificationEvent))) == []
            payload["jobs"].append(posting(2, "Engineer II"))
            second = await monitoring.run_monitoring(
                session, now=NOW + timedelta(minutes=5), client=client
            )
            assert second["events_queued"] == 1 and len(calls) == 2, (second, [s.model_dump() for s in session.exec(select(ScheduleBoardState))], [o.model_dump() for o in session.exec(select(Opportunity))])
            assert calls[1].headers["if-none-match"] == '"v1"'
            events = list(session.exec(select(OpportunityNotificationEvent)))
            assert {event.user_id for event in events} == {user.id}
            assert not list(
                session.exec(select(Opportunity).where(Opportunity.user_id == other.id))
            )
            unchanged = await monitoring.run_monitoring(
                session, now=NOW + timedelta(minutes=10), client=client
            )
            assert unchanged["events_queued"] == 0
            payload["jobs"][1]["content"] = "Build Python software. Salary $140,000."
            changed = await monitoring.run_monitoring(
                session, now=NOW + timedelta(minutes=15), client=client
            )
            assert changed["events_queued"] == 1
            assert (
                len(list(session.exec(select(NotificationDelivery)))) == 1
            )  # unsent backlog coalesces


@pytest.mark.asyncio
async def test_304_keeps_cached_jobs_and_backoff_preserves_last_success(engine):
    responses = [
        httpx.Response(200, json={"jobs": [posting()]}, headers={"etag": "x"}),
        httpx.Response(304),
        httpx.Response(429, headers={"retry-after": "900"}),
    ]
    with Session(engine) as session:
        setup(session)
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: responses.pop(0))
        ) as client:
            await monitoring.run_monitoring(session, now=NOW, client=client)
            result = await monitoring.run_monitoring(
                session, now=NOW + timedelta(minutes=5), client=client
            )
            assert result["events_queued"] == 0 and result["jobs_processed"] == 0
            failed = await monitoring.run_monitoring(
                session, now=NOW + timedelta(minutes=10), client=client
            )
            assert failed["feed_errors"] == 1
            feed = session.get(PublicBoardFeed, feed_key("greenhouse", "alpha"))
            assert feed.last_success_at == NOW + timedelta(minutes=5)
            assert feed.next_poll_at == NOW + timedelta(minutes=25)
            skipped = await monitoring.run_monitoring(
                session, now=NOW + timedelta(minutes=15), client=client
            )
            assert skipped["requests"] == 0


@pytest.mark.asyncio
async def test_budget_between_boards_resumes_without_repeating_finished_board(engine, monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(monitoring, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original = monitoring._ingest_page
    processed = []

    def consume(session, schedule, state, rows, now):
        processed.append(state.feed_key)
        result = original(session, schedule, state, rows, now)
        clock[0] += 2
        return result

    monkeypatch.setattr(monitoring, "_ingest_page", consume)
    with Session(engine) as session:
        _, _, schedule = setup(session, boards=("alpha", "beta", "gamma"))
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"jobs": [posting()]}))
        ) as client:
            for index in range(3):
                clock[0] = 0
                await monitoring.run_monitoring(
                    session, now=NOW + timedelta(minutes=5 * index), client=client, work_seconds=2
                )
                session.refresh(schedule)
                if index < 2:
                    assert schedule.last_success_at is None
                    assert schedule.monitoring_cycle_at == NOW
            assert schedule.last_success_at == NOW + timedelta(minutes=10)
            assert len(processed) == len(set(processed)) == 3
            assert len(list(session.exec(select(ScheduleBoardState)))) == 3


@pytest.mark.asyncio
async def test_pilot_caps_and_disabled_default_do_not_fetch(engine, monkeypatch):
    with Session(engine) as session:
        for index in range(6):
            setup(session, str(index))
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: pytest.fail("must not fetch"))
        ) as client:
            assert (await monitoring.run_monitoring(session, now=NOW, client=client))[
                "status"
            ] == "capacity_exceeded"
            monkeypatch.setattr(
                monitoring, "get_settings", lambda: SimpleNamespace(monitoring_enabled=False)
            )
            assert (await monitoring.run_monitoring(session, now=NOW, client=client))[
                "status"
            ] == "disabled"


@pytest.mark.asyncio
async def test_ten_distinct_board_cap_counts_shared_sources_once(engine):
    with Session(engine) as session:
        setup(session, boards=tuple(f"board{i}" for i in range(10)))
        setup(session, "shared", boards=("board0",))
        assert (
            len(monitoring.validate_capacity(session, monitoring.continuous_schedules(session)))
            == 10
        )
        setup(session, "extra", boards=("eleventh",))
        with pytest.raises(ValueError, match="ten distinct"):
            monitoring.validate_capacity(session, monitoring.continuous_schedules(session))


def test_atomic_competing_claims_and_expired_owner_cannot_release_successor(tmp_path):
    db = create_engine(
        f"sqlite:///{tmp_path / 'leases.sqlite'}", connect_args={"check_same_thread": False}
    )
    SQLModel.metadata.create_all(db)
    with Session(db) as session:
        session.add(MonitoringLease(key="tick"))
        session.commit()
    barrier = Barrier(2)

    def claim():
        with Session(db) as session:
            barrier.wait()
            return work_claims.acquire(session, "tick", NOW)

    with ThreadPoolExecutor(max_workers=2) as pool:
        winners = list(pool.map(lambda _: claim(), range(2)))
    assert sum(token is not None for token in winners) == 1
    stale = next(token for token in winners if token)
    with Session(db) as session:
        fresh = work_claims.acquire(session, "tick", NOW + timedelta(minutes=4))
        assert fresh and fresh != stale
        work_claims.release(session, "tick", stale)
        assert session.get(MonitoringLease, "tick").token == fresh
        assert work_claims.acquire(session, "tick", NOW + timedelta(minutes=4)) is None


@pytest.mark.asyncio
async def test_busy_worker_and_paused_profile_do_no_work(engine):
    with Session(engine) as session:
        _, profile, schedule = setup(session)
        token = work_claims.acquire(session, "monitoring-tick", NOW)
        assert (await monitoring.run_monitoring(session, now=NOW))["status"] == "busy"
        work_claims.release(session, "monitoring-tick", token)
        profile.is_active = False
        session.add(profile)
        session.commit()
        assert (await monitoring.run_monitoring(session, now=NOW))["status"] == "idle"
        assert not due_schedule(schedule, NOW)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,payload",
    [
        ("lever", [{"id": "1", "text": "Engineer", "hostedUrl": "https://example.test/1"}]),
        ("ashby", {"jobs": [{"id": "1", "title": "Engineer", "jobUrl": "https://example.test/1"}]}),
    ],
)
async def test_supported_provider_parsers(provider, payload):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload))
    ) as client:
        result = await fetch_feed(client, provider, "alpha")
        assert len(result.jobs) == 1 and result.jobs[0]["title"] == "Engineer"


@pytest.mark.asyncio
async def test_feed_concurrency_is_bounded(engine):
    active = peak = 0

    async def handler(request):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return httpx.Response(200, json={"jobs": []})

    with Session(engine) as session:
        setup(session, boards=("one", "two", "three", "four"))
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await monitoring.run_monitoring(session, now=NOW, client=client)
        assert result["requests"] == 4 and peak == 2


@pytest.mark.asyncio
async def test_bad_feed_is_not_an_empty_successful_baseline(engine):
    with Session(engine) as session:
        _, _, schedule = setup(session)
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"error": "oops"}))
        ) as client:
            result = await monitoring.run_monitoring(session, now=NOW, client=client)
        assert result["feed_errors"] == 1 and schedule.last_success_at is None


def test_schedule_api_opt_in_validation_status_and_legacy_round_trip(client, engine):
    with Session(engine) as session:
        profile = CareerProfile(user_id=client.user_id, name="API profile")
        session.add(profile)
        session.commit()
        session.refresh(profile)
        profile_id = profile.id
    payload = {"professional_profile_id": profile_id, "cadence": "continuous"}
    assert client.post("/api/discovery/schedules", json=payload).status_code == 422
    with Session(engine) as session:
        session.add(
            SearchSource(
                user_id=client.user_id,
                provider="greenhouse",
                company_name="Alpha",
                board_key="alpha",
            )
        )
        session.commit()
    response = client.post("/api/discovery/schedules", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["email_provider_status"] == "unconfigured"
    assert len(response.json()["monitored_sources"]) == 1
    for cadence in ("daily", "weekdays", "weekly"):
        saved = client.post("/api/discovery/schedules", json={**payload, "cadence": cadence})
        assert saved.status_code == 200 and saved.json()["cadence"] == cadence
    assert (
        client.post(
            "/api/discovery/schedules", json={**payload, "timezone": "Not/AZone"}
        ).status_code
        == 422
    )


@pytest.mark.asyncio
async def test_unchanged_feed_rechecks_changed_profile_without_activation_flood(engine):
    with Session(engine) as session:
        user, profile, _ = setup(session)
        profile.exclude_keywords = ["Engineer"]
        session.add(profile)
        session.commit()
        responses = [httpx.Response(200, json={"jobs": [posting()]}), httpx.Response(304)]
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: responses.pop(0))) as client:
            baseline = await monitoring.run_monitoring(session, now=NOW, client=client)
            assert baseline["events_queued"] == 0
            profile.exclude_keywords = []
            session.add(profile)
            session.commit()
            result = await monitoring.run_monitoring(session, now=NOW+timedelta(minutes=5), client=client)
            assert result["events_queued"] == 1
            assert session.exec(select(OpportunityNotificationEvent)).one().user_id == user.id


def test_read_only_monitoring_cli_never_acquires_claims_or_fetches(engine, monkeypatch, capsys):
    from kall.jobs import monitoring as job
    monkeypatch.setattr(job, "engine", engine)
    with Session(engine) as session:
        setup(session)
    assert job.main(["--dry-run"]) == 0
    assert '"profiles": 1' in capsys.readouterr().out
    with Session(engine) as session:
        assert list(session.exec(select(MonitoringLease))) == []
        assert list(session.exec(select(PublicBoardFeed))) == []


@pytest.mark.asyncio
async def test_changed_department_evidence_is_material_and_refreshes_job(engine):
    from kall.models import Job
    payload = {"jobs": [{**posting(), "departments": [{"name": "Engineering"}]}]}
    with Session(engine) as session:
        setup(session)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload))) as client:
            await monitoring.run_monitoring(session, now=NOW, client=client)
            payload["jobs"][0]["departments"] = [{"name": "Quality Engineering"}]
            changed = await monitoring.run_monitoring(session, now=NOW+timedelta(minutes=5), client=client)
            assert changed["events_queued"] == 1
            job = session.exec(select(Job)).one()
            assert job.metadata_json["departments"] == [{"name": "Quality Engineering"}]
