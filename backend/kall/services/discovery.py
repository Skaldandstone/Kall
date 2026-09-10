import re
from urllib.parse import urlsplit

from kall.clock import utcnow
from kall.models import CareerProfile, SearchRun, SearchSource, User
from kall.providers.ashby import AshbyProvider
from kall.providers.greenhouse import GreenhouseProvider
from kall.providers.jobs import DiscoveredJob
from kall.providers.lever import LeverProvider
from kall.services.ats_web_search import build_ats_queries, build_search_intent
from kall.services.discovery_matching import ingest_discovered_jobs
from kall.services.job_search_aggregation import aggregate_job_search
from sqlmodel import Session, select

PROVIDERS={
    "greenhouse": GreenhouseProvider,
    "lever": LeverProvider,
    "ashby": AshbyProvider,
}

#: Job-board pages title their postings "Role - Company", "Role at Company",
#: "Company - Role" or "Role | Company | Location". These split on the first
#: such separator; which side is the company is decided in _split_web_title.
_TITLE_SEPARATORS = re.compile(r"\s+(?:-|–|—|\||@|at)\s+", re.IGNORECASE)
_TRAILING_SITE = re.compile(r"\s*[|\-–—]\s*(?:Jobs?|Careers?|Job Board|Job Application(?: for)?)\b.*$", re.IGNORECASE)


#: ATS hosts whose first path segment is the employer's board slug, e.g.
#: boards.greenhouse.io/acme/jobs/123 -- a far more reliable company name
#: than anything parsed out of the page title.
_SLUG_HOSTS = ("boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com", "jobs.smartrecruiters.com", "apply.workable.com")


def _company_from_url(url: str) -> str | None:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if not host.endswith(_SLUG_HOSTS):
        return None
    segments = [segment for segment in parts.path.split("/") if segment]
    if not segments or segments[0].lower() in {"jobs", "job", "embed"}:
        return None
    return segments[0].replace("-", " ").replace("_", " ").strip().title() or None


def _split_web_title(raw_title: str, fallback_company: str) -> tuple[str, str]:
    """(company, title) from a search-result page title, best effort.

    Wrong guesses are cheap here -- matching scores on the whole text, and the
    posting's own page is one tap away -- but a plausible company name is what
    lets the feed read as a list of roles instead of a list of URLs.
    """
    title = _TRAILING_SITE.sub("", raw_title).strip() or raw_title.strip()
    title = re.sub(r"^Job Application for\s+", "", title, flags=re.IGNORECASE)
    parts = [part.strip() for part in _TITLE_SEPARATORS.split(title) if part.strip()]
    if len(parts) < 2:
        return fallback_company, title
    # "Role at Company" puts the company last; "Company - Role" puts it
    # first. A lone "at" is unambiguous; otherwise the shorter side is
    # usually the company name.
    if re.search(r"\s+at\s+", title, re.IGNORECASE):
        return parts[-1], " at ".join(parts[:-1])
    if len(parts[0]) <= len(parts[1]):
        return parts[0], parts[1]
    return parts[1], parts[0]


def web_results_to_jobs(results: list[dict]) -> list[DiscoveredJob]:
    """Turn aggregate_job_search's hits into the same DiscoveredJob shape the
    structured board providers produce, so one ingestion path scores and
    tracks both. The snippet is the only description available up front."""
    jobs: list[DiscoveredJob] = []
    for item in results:
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip()
        if not url or not title:
            continue
        host = urlsplit(url).hostname or ""
        slug_company = _company_from_url(url)
        company, role = _split_web_title(title, item.get("provider") or host)
        if slug_company:
            company = slug_company
        jobs.append(DiscoveredJob(
            source="ats_search",
            external_id=None,
            company=company,
            title=role,
            description=item.get("snippet") or "",
            url=url,
            metadata={"provider": item.get("provider"), "domain": item.get("domain") or host},
        ))
    return jobs


async def run_discovery(
    session: Session,
    user: User,
    profile: CareerProfile,
    *,
    max_posting_age_days: int | None = None,
    intent: str | None = None,
) -> SearchRun:
    """`max_posting_age_days` is DiscoverySchedule's own setting, not the
    manual "search now" button's -- callers on that path pass nothing, so
    manual search behaves exactly as before. A job with no `posted_at`
    (most providers don't supply one -- see providers/jobs.py) is never
    rejected for missing data, the same rule matching.location_out_of_scope
    already follows.

    `intent` replaces the profile's own hidden-market boolean for this run
    only -- extra terms someone typed on the search screen. Structured
    company boards ignore it; they return whatever they list.
    """
    sources = list(session.exec(select(SearchSource).where(SearchSource.user_id == user.id, SearchSource.enabled)))
    # The same intent boolean run against every site in the web workspace's
    # hidden-market search -- there is no longer one merged query to point
    # to (see build_ats_queries), so this is the shared part of all of them.
    # Structured providers continue importing jobs; this is recorded on the
    # run itself so history shows what was actually searched for at the
    # time, even after the profile's own criteria change.
    ats_query = (intent or "").strip() or build_search_intent(profile)
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

    # The hidden market: the same per-site search the web workspace runs,
    # ingested as real jobs so they score, track and show up in the feed and
    # the brief. Before this, a manual "search now" only ever read the
    # company boards someone had configured by hand -- an account with none
    # (every new account) searched nothing and reported "0 collected", which
    # looked like the search was broken.
    queries = build_ats_queries(profile)
    if intent and intent.strip():
        queries = [{**item, "query": f"site:{item['domain']} {intent.strip()}"} for item in queries]
    try:
        aggregated = await aggregate_job_search(queries)
    except Exception as exc:
        errors.append(f"ats_search: {exc}")
        aggregated = {"enabled": False, "results": [], "sites_searched": 0, "sites_failed": 0}
    if aggregated["enabled"]:
        batch = ingest_discovered_jobs(session, user, profile, web_results_to_jobs(aggregated["results"]),
                                       max_posting_age_days=max_posting_age_days)
        collected += batch["jobs_collected"]
        created += batch["jobs_created"]
        matched += batch["matches_created"]
        skipped += batch["jobs_skipped"]
        if aggregated["sites_searched"] and aggregated["sites_failed"] == aggregated["sites_searched"]:
            errors.append("ats_search: every job site search failed")
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
