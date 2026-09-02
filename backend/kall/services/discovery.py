
from kall.clock import utcnow
from kall.models import CareerProfile, SearchRun, SearchSource, User
from kall.providers.ashby import AshbyProvider
from kall.providers.greenhouse import GreenhouseProvider
from kall.providers.lever import LeverProvider
from kall.services.ats_web_search import build_search_intent
from kall.services.discovery_matching import ingest_discovered_jobs
from sqlmodel import Session, select

PROVIDERS={
    "greenhouse": GreenhouseProvider,
    "lever": LeverProvider,
    "ashby": AshbyProvider,
}


async def run_discovery(
    session: Session, user: User, profile: CareerProfile, *, max_posting_age_days: int | None = None
) -> SearchRun:
    """`max_posting_age_days` is DiscoverySchedule's own setting, not the
    manual "search now" button's -- callers on that path pass nothing, so
    manual search behaves exactly as before. A job with no `posted_at`
    (most providers don't supply one -- see providers/jobs.py) is never
    rejected for missing data, the same rule matching.location_out_of_scope
    already follows."""
    sources = list(session.exec(select(SearchSource).where(SearchSource.user_id == user.id, SearchSource.enabled)))
    # The same intent boolean run against every site in the web workspace's
    # hidden-market search -- there is no longer one merged query to point
    # to (see build_ats_queries), so this is the shared part of all of them.
    # Structured providers continue importing jobs; this is recorded on the
    # run itself so history shows what was actually searched for at the
    # time, even after the profile's own criteria change.
    ats_query = build_search_intent(profile)
    requested_providers = {s.provider for s in sources}
    requested_providers.add("ats_search")
    run=SearchRun(
        user_id=user.id,
        professional_profile_id=profile.id,
        providers_requested=sorted(requested_providers),
        ats_search_query=ats_query,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    # Postings the user has flagged as dead. Loaded once per run rather than
    # queried per job, and applied before any Job/JobMatch/Opportunity row is
    # touched -- otherwise a dead posting quietly reappears in the daily brief
    # every time the board still lists it.
    ingest_discovered_jobs(session, user, profile, [])
    collected=created=matched=0
    skipped=0
    errors=[]
    for source in sources:
        provider_type=PROVIDERS.get(source.provider)
        if not provider_type:
            errors.append(f"Unsupported provider: {source.provider}")
            continue
        try:
            jobs=await provider_type().collect(source.company_name,source.board_key)
            batch = ingest_discovered_jobs(session, user, profile, jobs, max_posting_age_days=max_posting_age_days)
            collected += batch["jobs_collected"]
            created += batch["jobs_created"]
            matched += batch["matches_created"]
            skipped += batch["jobs_skipped"]
        except Exception as exc:
            errors.append(f"{source.company_name}/{source.provider}: {exc}")
    run.completed_at = utcnow()
    run.jobs_collected = collected
    # Its own field, not an entry in `errors` -- a skip is a deliberate user
    # choice, and putting it there would flip the run's status to
    # completed_with_errors and read as a malfunction in run history.
    run.jobs_skipped = skipped
    run.jobs_created = created
    run.matches_created = matched
    run.errors = errors
    run.status = "completed_with_errors" if errors else "completed"
    session.add(run)
    session.commit()
    session.refresh(run)
    return run
