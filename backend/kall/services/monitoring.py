"""One bounded, shared polling tick for the opt-in company-board pilot."""

import asyncio
import time
from datetime import datetime, timedelta

import httpx
from kall.config import get_settings
from kall.models import (
    CareerProfile,
    DiscoverySchedule,
    Job,
    MonitoringObservation,
    Opportunity,
    PublicBoardFeed,
    ScheduleBoardState,
    SearchRun,
    SearchSource,
    User,
)
from kall.providers.board_feed import content_version, decode_jobs, feed_key, fetch_feed
from kall.services import work_claims
from kall.services.discovery_matching import ingest_discovered_jobs
from kall.services.normalization import normalize_discovered
from kall.services.opportunities import material_fingerprint
from kall.services.opportunity_notifications import preference_for, prepare_deliveries, record_event
from sqlmodel import Session, select

MAX_PROFILES = 5
MAX_BOARDS = 10
INTERVAL_SECONDS = 300
WORK_SECONDS = 120
PAGE_SIZE = 25


def continuous_schedules(session: Session) -> list[DiscoverySchedule]:
    return list(session.exec(select(DiscoverySchedule).join(
        CareerProfile, CareerProfile.id == DiscoverySchedule.professional_profile_id,
    ).join(User, User.id == DiscoverySchedule.user_id).where(
        DiscoverySchedule.enabled.is_(True), DiscoverySchedule.cadence == "continuous",
        CareerProfile.is_active.is_(True), CareerProfile.user_id == User.id, User.is_active.is_(True),
    ).order_by(DiscoverySchedule.next_run_at, DiscoverySchedule.id)))


def sources_for(session: Session, user_id: int) -> list[SearchSource]:
    return list(session.exec(select(SearchSource).where(
        SearchSource.user_id == user_id, SearchSource.enabled.is_(True),
    ).order_by(SearchSource.id)))


def validate_capacity(session: Session, schedules: list[DiscoverySchedule]) -> dict[str, tuple[str, str]]:
    profiles = {(row.user_id, row.professional_profile_id) for row in schedules}
    if len(profiles) > MAX_PROFILES:
        raise ValueError("The monitoring pilot is limited to five active profiles globally.")
    boards = {}
    for user_id in sorted({row.user_id for row in schedules}):
        for source in sources_for(session, user_id):
            key = feed_key(source.provider, source.board_key)
            boards[key] = (source.provider, source.board_key)
    if len(boards) > MAX_BOARDS:
        raise ValueError("The monitoring pilot is limited to ten distinct company boards globally.")
    return boards


def _ensure_feed(session: Session, key: str, provider: str, board: str) -> PublicBoardFeed:
    feed = session.get(PublicBoardFeed, key)
    if feed is None:
        feed = PublicBoardFeed(key=key, provider=provider, board_key=board)
        session.add(feed)
        session.commit()
    return feed


async def _poll(session: Session, feeds: list[PublicBoardFeed], now: datetime,
                client: httpx.AsyncClient, deadline: float) -> dict[str, int]:
    semaphore = asyncio.Semaphore(2)

    async def fetch(feed: PublicBoardFeed):
        async with semaphore:
            remaining = deadline - time.monotonic()
            if remaining < 1:
                return feed.key, None, "Work budget reached", None
            try:
                async with asyncio.timeout(min(20, remaining)):
                    result = await fetch_feed(client, feed.provider, feed.board_key,
                                              etag=feed.etag, last_modified=feed.last_modified)
                return feed.key, result, None, None
            except httpx.HTTPStatusError as error:
                retry_after = error.response.headers.get("retry-after", "")
                seconds = min(86400, max(300, int(retry_after))) if retry_after.isdigit() else None
                return feed.key, None, f"Provider returned HTTP {error.response.status_code}", seconds
            except (httpx.HTTPError, ValueError, TimeoutError) as error:
                return feed.key, None, f"Feed unavailable ({type(error).__name__})", None

    due = [feed for feed in feeds if not feed.next_poll_at or feed.next_poll_at <= now]
    results = await asyncio.gather(*(fetch(feed) for feed in due))
    counts = {"requests": sum(error != "Work budget reached" for _, _, error, _ in results), "response_bytes": 0, "feed_errors": 0}
    for key, result, error, retry_seconds in results:
        feed = session.get(PublicBoardFeed, key)
        if error == "Work budget reached":
            continue
        feed.last_checked_at = now
        if error:
            feed.failures += 1
            feed.last_error = error
            feed.next_poll_at = now + timedelta(seconds=retry_seconds or min(3600, 300 * 2 ** min(feed.failures - 1, 4)))
            counts["feed_errors"] += 1
        elif result.jobs is None and feed.last_success_at is None:
            feed.etag = feed.last_modified = None
            feed.last_error = "Provider returned 304 without an existing baseline."
            feed.next_poll_at = now + timedelta(seconds=INTERVAL_SECONDS)
            counts["feed_errors"] += 1
        else:
            if result.jobs is not None:
                feed.jobs = result.jobs
                feed.version = content_version(result.jobs)
            feed.etag = result.etag
            feed.last_modified = result.last_modified
            feed.response_bytes = result.response_bytes
            feed.last_success_at = now
            feed.next_poll_at = now + timedelta(seconds=INTERVAL_SECONDS)
            feed.failures = 0
            feed.last_error = None
            counts["response_bytes"] += result.response_bytes
        session.add(feed)
    session.commit()
    return counts


def _board_state(session: Session, schedule: DiscoverySchedule, feed: PublicBoardFeed) -> ScheduleBoardState:
    row = session.exec(select(ScheduleBoardState).where(
        ScheduleBoardState.schedule_id == schedule.id, ScheduleBoardState.feed_key == feed.key,
    )).first()
    if row is None:
        row = ScheduleBoardState(schedule_id=schedule.id, feed_key=feed.key)
        session.add(row)
        session.commit()
    return row


def _criteria_version(session: Session, schedule: DiscoverySchedule) -> str:
    import hashlib
    import json
    profile = session.get(CareerProfile, schedule.professional_profile_id)
    preference = preference_for(session, schedule.user_id)
    data = {"profile": profile.model_dump(mode="json"), "minimum_score": preference.minimum_match_score,
            "email_enabled": preference.email_enabled, "max_age": schedule.max_posting_age_days}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def _ingest_page(session: Session, schedule: DiscoverySchedule, state: ScheduleBoardState,
                 rows: list[dict], now: datetime) -> int:
    user = session.get(User, schedule.user_id)
    profile = session.get(CareerProfile, schedule.professional_profile_id)
    if not user or not user.is_active or not profile or not profile.is_active:
        return 0
    jobs = decode_jobs(rows)
    if state.initialized and state.criteria_version == _criteria_version(session, schedule):
        changed = []
        for discovered in jobs:
            normalized = normalize_discovered(discovered)
            job = session.exec(select(Job).where(Job.url == normalized["url"])).first()
            observation = session.exec(select(MonitoringObservation).where(
                MonitoringObservation.board_state_id == state.id,
                MonitoringObservation.job_id == job.id,
            )).first() if job else None
            if observation is None or observation.fingerprint != material_fingerprint(Job(**normalized)):
                changed.append(discovered)
        jobs = changed
    result = ingest_discovered_jobs(session, user, profile, jobs,
                                    max_posting_age_days=schedule.max_posting_age_days, refresh_saved_matches=False)
    eligible = {row.job_id: row for row in session.exec(select(Opportunity).where(
        Opportunity.id.in_(result["opportunity_ids"]), Opportunity.user_id == user.id,
    ))}
    preference = preference_for(session, user.id)
    queued = 0
    for discovered in jobs:
        job = session.exec(select(Job).where(Job.url == normalize_discovered(discovered)["url"])).first()
        if job is None:
            continue
        opportunity = eligible.get(job.id)
        qualifies = bool(opportunity and opportunity.match_score >= preference.minimum_match_score
                         and opportunity.state in ("new", "saved", "reviewing"))
        fingerprint = material_fingerprint(job)
        observation = session.exec(select(MonitoringObservation).where(
            MonitoringObservation.board_state_id == state.id, MonitoringObservation.job_id == job.id,
        )).first()
        changed = observation is None or observation.fingerprint != fingerprint or not observation.qualifying
        if state.initialized and qualifies and changed and preference.email_enabled:
            queued += int(record_event(session, user.id, job.id, fingerprint))
        if observation is None:
            observation = MonitoringObservation(board_state_id=state.id, job_id=job.id, fingerprint=fingerprint)
        observation.fingerprint = fingerprint
        observation.qualifying = qualifies
        observation.updated_at = now
        session.add(observation)
    state.cursor += len(rows)
    session.add(state)
    session.commit()
    return queued


async def run_monitoring(session: Session, *, now: datetime | None = None,
                         client: httpx.AsyncClient | None = None, work_seconds: float = WORK_SECONDS,
                         send_notifications: bool = False) -> dict:
    started = time.monotonic()
    deadline = started + min(WORK_SECONDS, max(0, work_seconds))
    now = now or datetime.utcnow()
    result = {"status": "disabled", "requests": 0, "response_bytes": 0, "feed_errors": 0,
              "profiles_checked": 0, "jobs_processed": 0, "events_queued": 0}
    if not get_settings().monitoring_enabled:
        return result
    token = work_claims.acquire(session, "monitoring-tick", now, seconds=180)
    if not token:
        return {**result, "status": "busy"}
    owned_client = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(20, connect=3), follow_redirects=False)
    try:
        schedules = continuous_schedules(session)
        try:
            boards = validate_capacity(session, schedules)
        except ValueError as error:
            for schedule in schedules:
                schedule.last_error = str(error)
                session.add(schedule)
            session.commit()
            return {**result, "status": "capacity_exceeded"}
        if not boards:
            for schedule in schedules:
                schedule.last_error = "No company boards configured."
                session.add(schedule)
            session.commit()
            return {**result, "status": "unconfigured" if schedules else "idle"}
        feeds = [_ensure_feed(session, key, *value) for key, value in boards.items()]
        result.update(await _poll(session, feeds, now, client, deadline))
        for schedule in schedules:
            if schedule.next_run_at and schedule.next_run_at > now:
                continue
            if time.monotonic() >= deadline:
                break
            # Refresh historical matches once, even if all feeds are empty or unavailable.
            ingest_discovered_jobs(session, session.get(User, schedule.user_id),
                                   session.get(CareerProfile, schedule.professional_profile_id), [])
            schedule.monitoring_cycle_at = schedule.monitoring_cycle_at or now
            schedule.last_run_at = now
            schedule.last_error = None
            run = SearchRun(user_id=schedule.user_id, professional_profile_id=schedule.professional_profile_id,
                            started_at=now, providers_requested=["company_board_monitoring"])
            session.add(run)
            session.flush()
            complete = True
            seen = set()
            for source in sources_for(session, schedule.user_id):
                key = feed_key(source.provider, source.board_key)
                if key in seen:
                    continue
                seen.add(key)
                if time.monotonic() >= deadline:
                    complete = False
                    schedule.last_error = "Work budget reached; remaining boards resume next tick."
                    break
                feed = session.get(PublicBoardFeed, key)
                if not feed.last_success_at or feed.last_error:
                    complete = False
                    schedule.last_error = feed.last_error or "Waiting for the first successful board fetch."
                    continue
                state = _board_state(session, schedule, feed)
                if state.completed_cycle_at == schedule.monitoring_cycle_at:
                    continue
                criteria = _criteria_version(session, schedule)
                if state.initialized and state.version == feed.version and state.criteria_version == criteria:
                    state.completed_cycle_at = schedule.monitoring_cycle_at
                    state.last_success_at = now
                    session.add(state)
                    continue
                if state.cycle_at != schedule.monitoring_cycle_at:
                    state.cycle_at = schedule.monitoring_cycle_at
                    state.cursor = 0
                if state.version != feed.version:
                    state.version, state.cursor = feed.version, 0
                while state.cursor < len(feed.jobs):
                    if time.monotonic() >= deadline:
                        complete = False
                        schedule.last_error = "Work budget reached; remaining postings resume next tick."
                        break
                    page = feed.jobs[state.cursor:state.cursor + PAGE_SIZE]
                    result["events_queued"] += _ingest_page(session, schedule, state, page, now)
                    result["jobs_processed"] += len(page)
                    run.jobs_collected += len(page)
                if state.cursor >= len(feed.jobs):
                    state.initialized = True
                    state.last_success_at = now
                    state.completed_cycle_at = schedule.monitoring_cycle_at
                    state.criteria_version = criteria
                session.add(state)
            if not seen:
                complete = False
                schedule.last_error = "No company boards configured."
            run.status = "completed" if complete else "completed_with_errors"
            run.errors = [schedule.last_error] if schedule.last_error else []
            run.completed_at = now
            if complete:
                schedule.last_success_at = now
                schedule.monitoring_cycle_at = None
                schedule.next_run_at = now + timedelta(seconds=INTERVAL_SECONDS)
                result["profiles_checked"] += 1
            else:
                schedule.next_run_at = now
            session.add(run)
            session.add(schedule)
            session.commit()
            if time.monotonic() >= deadline:
                break
        if deadline - time.monotonic() >= 2:
            prepare_deliveries(session, now=now, deadline=deadline, limit=5)
        if send_notifications and deadline - time.monotonic() >= 15:
            from kall.services.notification_delivery import drain
            result["deliveries"] = drain(session, now=now, limit=5, deadline=deadline)
        result["status"] = "delayed" if time.monotonic() >= deadline or result["feed_errors"] or any(s.last_error for s in schedules) else "completed"
        result["elapsed_seconds"] = round(time.monotonic() - started, 3)
        return result
    finally:
        if owned_client:
            await client.aclose()
        work_claims.release(session, "monitoring-tick", token)
