"""Canonical sources retain their own evidence through monitoring and delivery."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from kall.models import (
    Application,
    CareerProfile,
    DiscoverySchedule,
    Job,
    JobMatch,
    MonitoringObservation,
    NotificationDelivery,
    NotificationPreference,
    Opportunity,
    OpportunityNotificationEvent,
    PublicBoardFeed,
    ScheduleBoardState,
    SearchSource,
    User,
)
from kall.providers.board_feed import encode_jobs
from kall.providers.jobs import DiscoveredJob
from kall.services import monitoring
from kall.services.discovery_matching import ingest_discovered_jobs
from kall.services.monitoring import _ingest_page
from kall.services.notification_delivery import process_delivery
from kall.services.notifications import NotificationService
from kall.services.opportunities import material_fingerprint
from kall.services.opportunity_notifications import (
    eligible_opportunities,
    prepare_deliveries,
    record_event,
)
from sqlmodel import Session, select

NOW = datetime(2026, 8, 30, 12)


def posting(source, description="Build systems", **kwargs):
    return DiscoveredJob(source=source, external_id=source, company="Example", title="Engineer",
                         location="Remote", description=description,
                         url=f"https://example.test/{source}", **kwargs)


def setup(session, suffix="one"):
    user = User(clerk_user_id=suffix, email=f"{suffix}@example.test", full_name=suffix)
    session.add(user)
    session.flush()
    profile = CareerProfile(user_id=user.id, name=suffix, target_titles=["Engineer"],
                            include_keywords=["automation", "leadership", "python"])
    session.add(profile)
    session.flush()
    schedule = DiscoverySchedule(user_id=user.id, professional_profile_id=profile.id, cadence="continuous")
    session.add(schedule)
    session.add(NotificationPreference(user_id=user.id, minimum_match_score=60, delivery_mode="immediate"))
    session.flush()
    states = []
    for source in ("greenhouse", "lever"):
        feed_id = f"{suffix}-{source}"
        session.add(PublicBoardFeed(key=feed_id, provider=source, board_key="example"))
        session.flush()
        state = ScheduleBoardState(schedule_id=schedule.id, feed_key=feed_id, initialized=source == "lever")
        session.add(state)
        states.append(state)
    session.commit()
    return user, profile, schedule, states


@pytest.fixture
def sender(monkeypatch):
    sent = []
    monkeypatch.setattr(NotificationService, "send_email", lambda self, *a, **k: sent.append(a) or "mock-id")
    return sent


def test_new_qualifying_canonical_source_keeps_evidence_and_delivers_once(engine, sender):
    with Session(engine) as session:
        user, profile, schedule, (first, second) = setup(session)
        assert _ingest_page(session, schedule, first, encode_jobs([posting("greenhouse")]), NOW) == 0
        row = session.exec(select(Opportunity)).one()
        row.state, row.notes = "saved", "Keep workflow"
        row_id, first_seen = row.id, row.first_seen_at
        session.add(row)
        session.commit()
        assert _ingest_page(session, schedule, second, encode_jobs([posting("lever", "automation leadership python")]), NOW) == 1
        jobs = {j.source: j for j in session.exec(select(Job))}
        matches = {m.job_id: m for m in session.exec(select(JobMatch))}
        assert matches[jobs["greenhouse"].id].score == 45
        assert matches[jobs["lever"].id].score == 75
        assert row.job_id == jobs["lever"].id and row.match_score == 75
        assert row.id == row_id and row.state == "saved" and row.notes == "Keep workflow"
        assert row.first_seen_at == first_seen
        assert len(session.exec(select(Opportunity)).all()) == 1
        assert eligible_opportunities(session, user.id, job_ids=[jobs["greenhouse"].id]) == []
        assert [o.id for o in eligible_opportunities(session, user.id, job_ids=[jobs["lever"].id])] == [row.id]
        observations = {o.job_id: o.qualifying for o in session.exec(select(MonitoringObservation))}
        assert observations == {jobs["greenhouse"].id: False, jobs["lever"].id: True}
        assert prepare_deliveries(session, now=NOW) == 1
        delivery = session.exec(select(NotificationDelivery)).one()
        assert process_delivery(session, delivery, now=NOW) == "sent"
        assert len(sender) == 1 and "75%" in sender[0][2] and "1 new match" in sender[0][2]
        assert session.exec(select(OpportunityNotificationEvent)).one().status == "sent"
        assert _ingest_page(session, schedule, second, encode_jobs([posting("lever", "automation leadership python")]), NOW) == 0


@pytest.mark.parametrize("order", [("greenhouse", "lever"), ("lever", "greenhouse")])
def test_qualifying_nonrepresentative_source_and_duplicate_events_coalesce(engine, sender, order):
    with Session(engine) as session:
        user, profile, schedule, states = setup(session)
        for source in order:
            ingest_discovered_jobs(session, user, profile, [posting(source, "automation leadership python")])
        row = session.exec(select(Opportunity)).one()
        jobs = {j.source: j for j in session.exec(select(Job))}
        representative = row.job_id
        assert representative == jobs[order[0]].id  # stable tie, not latest source
        for job in jobs.values():
            assert [o.id for o in eligible_opportunities(session, user.id, job_ids=[job.id])] == [row.id]
            assert record_event(session, user.id, job.id, material_fingerprint(job))
            assert not record_event(session, user.id, job.id, material_fingerprint(job))
        assert prepare_deliveries(session, now=NOW) == 1
        delivery = session.exec(select(NotificationDelivery)).one()
        assert delivery.payload["opportunity_ids"] == [row.id]
        assert process_delivery(session, delivery, now=NOW) == "sent"
        assert "1 new match" in sender[0][2] and len(sender) == 1
        assert {e.status for e in session.exec(select(OpportunityNotificationEvent))} == {"sent"}
        assert row.job_id == representative


@pytest.mark.parametrize("change", ["below_threshold", "excluded", "profile_paused"])
def test_changed_event_source_cannot_borrow_other_sources_score_at_send(engine, sender, change):
    with Session(engine) as session:
        user, profile, schedule, states = setup(session)
        ingest_discovered_jobs(session, user, profile, [posting("greenhouse", "automation leadership python"),
                                                      posting("lever", "automation leadership")])
        row = session.exec(select(Opportunity)).one()
        lever = session.exec(select(Job).where(Job.source == "lever")).one()
        assert row.match_score == 75 and row.job_id != lever.id
        assert record_event(session, user.id, lever.id, material_fingerprint(lever))
        assert prepare_deliveries(session, now=NOW) == 1
        delivery = session.exec(select(NotificationDelivery)).one()
        if change == "profile_paused":
            profile.is_active = False
            session.add(profile)
        else:
            lever.description = "Build systems" if change == "below_threshold" else "automation leadership forbidden"
            lever.updated_at = datetime.utcnow() + timedelta(seconds=1)
            if change == "excluded":
                profile.exclude_keywords = ["forbidden"]
                session.add(profile)
            session.add(lever)
        session.commit()
        assert process_delivery(session, delivery, now=NOW) == "skipped"
        assert sender == []
        assert session.exec(select(OpportunityNotificationEvent)).one().status == "skipped"
        assert row.match_score == 75  # other source still valid, but did not cause this alert


@pytest.mark.parametrize("state", ["saved", "apply", "not_interested", "archived"])
def test_representative_swap_and_old_source_edit_preserve_history(engine, state):
    with Session(engine) as session:
        user, profile, schedule, states = setup(session)
        ingest_discovered_jobs(session, user, profile, [posting("greenhouse", "automation leadership"),
                                                      posting("lever", "automation leadership python")])
        row = session.exec(select(Opportunity)).one()
        jobs = {j.source: j for j in session.exec(select(Job))}
        row.state, row.notes = state, "Interview notes"
        row.dismissed_fingerprint = "original dismissal"
        key, row_id, first_seen = row.canonical_key, row.id, row.first_seen_at
        application = Application(user_id=user.id, career_profile_id=profile.id,
                                  job_id=jobs["lever"].id, prepared_payload={"reviewed": True})
        session.add(application)
        session.add(row)
        session.commit()
        application_id, status = application.id, application.status
        assert row.job_id == jobs["lever"].id and row.match_score == 75
        ingest_discovered_jobs(session, user, profile, [posting("lever", "Build systems")])
        assert row.job_id == jobs["greenhouse"].id and row.match_score == 65
        # Editing a source which is no longer representative finds its original row.
        ingest_discovered_jobs(session, user, profile, [posting("lever", "automation leadership python changed")])
        assert row.job_id == jobs["lever"].id and row.match_score == 75
        assert row.material_fingerprint == material_fingerprint(jobs["lever"])
        assert row.id == row_id and row.canonical_key == key and row.first_seen_at == first_seen
        assert row.state == state and row.notes == "Interview notes" and row.dismissed_fingerprint == "original dismissal"
        assert len(session.exec(select(Opportunity)).all()) == 1
        assert len(session.exec(select(JobMatch)).all()) == 2
        assert {r["job_id"] for r in row.source_records} == {j.id for j in jobs.values()}
        session.refresh(application)
        assert application.id == application_id and application.status == status
        assert application.job_id == jobs["lever"].id and application.prepared_payload == {"reviewed": True}


def test_legacy_url_only_sources_repair_inconsistent_representative_without_losing_records(engine, sender):
    with Session(engine) as session:
        user, profile, schedule, states = setup(session)
        ingest_discovered_jobs(session, user, profile, [posting("greenhouse"), posting("lever", "automation leadership python")])
        row = session.exec(select(Opportunity)).one()
        jobs = {j.source: j for j in session.exec(select(Job))}
        row.job_id, row.match_score = jobs["greenhouse"].id, 75  # old buggy shape
        row.source_records = [{"source": j.source, "url": j.url, "audit_note": "retained"} for j in jobs.values()] + [{"url": "https://example.test/old", "audit_note": "unresolved history"}]
        session.add(row)
        session.commit()
        assert eligible_opportunities(session, user.id, job_ids=[jobs["greenhouse"].id]) == []
        assert [o.id for o in eligible_opportunities(session, user.id, job_ids=[jobs["lever"].id])] == [row.id]
        assert row.job_id == jobs["lever"].id
        ingest_discovered_jobs(session, user, profile, [posting("greenhouse")])
        assert len(row.source_records) == 3
        assert {record["audit_note"] for record in row.source_records} == {"retained", "unresolved history"}
        assert row.match_score == 75 and row.job_id == jobs["lever"].id


def test_cross_user_and_profile_matches_cannot_qualify_another_users_source(engine, sender):
    with Session(engine) as session:
        user, profile, schedule, states = setup(session)
        other, other_profile, _, _ = setup(session, "other")
        ingest_discovered_jobs(session, user, profile, [posting("greenhouse"), posting("lever", "automation leadership python")])
        profile.exclude_keywords = ["automation"]
        profile.updated_at = datetime.utcnow() + timedelta(seconds=1)
        session.add(profile)
        session.commit()
        ingest_discovered_jobs(session, other, other_profile, [posting("greenhouse"), posting("lever", "automation leadership python")])
        lever = session.exec(select(Job).where(Job.source == "lever")).one()
        assert eligible_opportunities(session, user.id, job_ids=[lever.id]) == []
        assert len(eligible_opportunities(session, other.id, job_ids=[lever.id])) == 1
        record_event(session, user.id, lever.id, material_fingerprint(lever))
        assert prepare_deliveries(session, now=NOW) == 0
        assert sender == []
        assert session.exec(select(OpportunityNotificationEvent)).one().status == "skipped"
        rows = session.exec(select(Opportunity)).all()
        assert len(rows) == 2 and {row.user_id for row in rows} == {user.id, other.id}


@pytest.mark.asyncio
async def test_full_worker_shared_canonical_sources_threshold_and_delivery(engine, sender, monkeypatch):
    monkeypatch.setattr(monitoring, "get_settings", lambda: SimpleNamespace(monitoring_enabled=True))
    cycle = 0
    calls = []
    def handler(request):
        calls.append(str(request.url))
        if "greenhouse" in str(request.url):
            return httpx.Response(200, json={"jobs": [{"id": "a", "title": "Engineer", "content": "Build systems",
                "absolute_url": "https://example.test/greenhouse", "location": {"name": "Remote"}}]})
        return httpx.Response(200, json=[] if cycle == 0 else [{"id": "b", "text": "Engineer",
            "descriptionPlain": "automation leadership python", "hostedUrl": "https://example.test/lever",
            "categories": {"location": "Remote"}}])
    with Session(engine) as session:
        user, profile, schedule, states = setup(session)
        for source in ("greenhouse", "lever"):
            session.add(SearchSource(user_id=user.id, provider=source, company_name="Example", board_key="example"))
        session.commit()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await monitoring.run_monitoring(session, now=NOW, client=client)
            assert first["events_queued"] == 0
            cycle = 1
            second = await monitoring.run_monitoring(session, now=NOW + timedelta(minutes=5), client=client)
            assert second["events_queued"] == 1
            assert second["requests"] == 2 and len(calls) == 4
            assert len(session.exec(select(Opportunity)).all()) == 1
            delivery = session.exec(select(NotificationDelivery)).one()
            assert process_delivery(session, delivery, now=NOW + timedelta(minutes=5)) == "sent"
            assert "75%" in sender[0][2]
            unchanged = await monitoring.run_monitoring(session, now=NOW + timedelta(minutes=10), client=client)
            assert unchanged["events_queued"] == 0 and len(sender) == 1


def test_browser_capture_source_joins_canonical_row_with_its_own_evidence(client, engine):
    with Session(engine) as session:
        profile = CareerProfile(user_id=client.user_id, name="Engineer", target_titles=["Engineer"],
                                include_keywords=["automation", "leadership", "python"])
        session.add(profile)
        session.commit()
        profile_id = profile.id
    first = client.post("/api/jobs/capture", json={"professional_profile_id": profile_id,
        "url": "https://example.test/capture-a", "title": "Engineer", "company": "Example",
        "location": "Remote", "description": "Build systems"})
    assert first.status_code == 200, first.text
    second = client.post("/api/jobs/capture", json={"professional_profile_id": profile_id,
        "url": "https://example.test/capture-b", "title": "Engineer", "company": "Example",
        "location": "Remote", "description": "automation leadership python"})
    assert second.status_code == 200, second.text
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["job_id"] != first.json()["job_id"]
    assert first.json()["match_score"] == 35 and second.json()["match_score"] == 65
    with Session(engine) as session:
        matches = session.exec(select(JobMatch).order_by(JobMatch.job_id)).all()
        assert [match.score for match in matches] == [35, 65]
        assert len(matches[1].strengths) > len(matches[0].strengths)


def test_materially_changed_nonrepresentative_source_alerts_on_its_own_evidence(engine, sender):
    with Session(engine) as session:
        user, profile, schedule, (first, second) = setup(session)
        second.initialized = False
        session.add(second)
        session.commit()
        _ingest_page(session, schedule, first, encode_jobs([posting("greenhouse", "automation leadership python")]), NOW)
        _ingest_page(session, schedule, second, encode_jobs([posting("lever", "automation leadership")]), NOW)
        row = session.exec(select(Opportunity)).one()
        representative_id = row.job_id
        second.initialized = True
        session.add(second)
        session.commit()
        assert _ingest_page(session, schedule, second,
                            encode_jobs([posting("lever", "automation leadership improved responsibilities")]), NOW) == 1
        assert row.job_id == representative_id and row.match_score == 75
        event = session.exec(select(OpportunityNotificationEvent)).one()
        assert event.job_id != row.job_id
        assert prepare_deliveries(session, now=NOW) == 1
        delivery = session.exec(select(NotificationDelivery)).one()
        assert process_delivery(session, delivery, now=NOW) == "sent"
        assert len(sender) == 1 and "75%" in sender[0][2]
        assert event.status == "sent"


def test_legacy_captured_sources_without_matches_do_not_reuse_an_aggregate_score(engine):
    with Session(engine) as session:
        user, profile, _, _ = setup(session)
        jobs = [Job(source=source, company="Example", title="Engineer", location="Remote", url=f"https://example.test/{source}",
                    description=description) for source, description in [("greenhouse", "Build systems"), ("lever", "automation leadership python")]]
        for job in jobs:
            session.add(job)
        session.flush()
        row = Opportunity(user_id=user.id, professional_profile_id=profile.id, job_id=jobs[0].id,
                          canonical_key="legacy", match_score=75, material_fingerprint="legacy",
                          source_records=[{"url": job.url, "source": job.source} for job in jobs])
        session.add(row)
        session.commit()
        assert eligible_opportunities(session, user.id, job_ids=[jobs[0].id]) == []
        assert [o.id for o in eligible_opportunities(session, user.id, job_ids=[jobs[1].id])] == [row.id]
        assert row.job_id == jobs[1].id and row.match_score == 65
        assert [m.score for m in session.exec(select(JobMatch).order_by(JobMatch.job_id))] == [35, 65]
