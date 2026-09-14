"""Generate a job-match digest for a SharedSearch, without ever touching the
owner's or friend's real pipeline.

`deterministic_match`/`is_out_of_scope` (services/matching.py) and
`build_ats_queries`/`build_search_intent` (services/ats_web_search.py) only
ever read plain attributes off whatever "profile" they're given -- never
`.id`, never a database query -- so MatchCriteria below is a duck-typed
stand-in for CareerProfile that works for both a live profile share and an
ad-hoc/friend-filled one, without changing either function.

generate_digest never calls ingest_discovered_jobs: nothing here is
persisted to Job/Opportunity/JobMatch, since those tables are FK'd to a
real user+profile and this is a read-only, non-owned search. Results live
only in SharedSearch.last_digest.
"""

import secrets
from dataclasses import dataclass, field
from datetime import timedelta

from kall.clock import utcnow
from kall.models import CareerProfile, Job, SharedSearch
from kall.services.ats_web_search import build_ats_queries
from kall.services.discovery import web_results_to_jobs
from kall.services.job_search_aggregation import aggregate_job_search
from kall.services.matching import deterministic_match, is_out_of_scope
from kall.services.normalization import normalize_discovered
from sqlmodel import Session, select

#: The lightweight criteria shape used for paths 2 and 3 -- deliberately a
#: subset of CareerProfile's fields (no salary/equity) to keep the intake
#: form a friend fills in short. include_keywords is the one place a very
#: specific ask ("C++ and DX12", not just "Software Engineer") belongs --
#: deterministic_match scores a keyword hit the same way it would for a
#: full CareerProfile.
CRITERIA_FIELDS = ("target_titles", "industries", "include_keywords", "countries", "states_regions", "cities", "work_types")

#: How many scored results a digest keeps, highest score first.
DIGEST_LIMIT = 20

#: A digest is not recomputed on every view -- only once this long has
#: passed since the last one, or when a caller explicitly forces it (the
#: public refresh endpoint, itself rate-limited).
DEFAULT_MIN_REFRESH_INTERVAL = timedelta(hours=6)


@dataclass
class MatchCriteria:
    """Everything deterministic_match/build_ats_queries actually read off a
    CareerProfile, with safe defaults for the fields the lightweight
    friend-facing form never collects."""

    name: str
    target_titles: list[str] = field(default_factory=list)
    industries: list[str] = field(default_factory=list)
    functional_areas: list[str] = field(default_factory=list)
    include_keywords: list[str] = field(default_factory=list)
    exclude_keywords: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=list)
    states_regions: list[str] = field(default_factory=list)
    cities: list[str] = field(default_factory=list)
    work_types: list[str] = field(default_factory=list)
    minimum_base: int | None = None
    equity_preference: str | None = None
    relocation_preference: str | None = None
    travel_max_percent: int | None = None


def _clean_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def criteria_from_dict(data: dict, *, name: str) -> MatchCriteria:
    data = data or {}
    return MatchCriteria(name=name, **{key: _clean_list(data.get(key)) for key in CRITERIA_FIELDS})


def _criteria_from_profile(profile: CareerProfile) -> MatchCriteria:
    return MatchCriteria(
        name=profile.name,
        target_titles=profile.target_titles,
        industries=profile.industries,
        functional_areas=profile.functional_areas,
        include_keywords=profile.include_keywords,
        exclude_keywords=profile.exclude_keywords,
        countries=profile.countries,
        states_regions=profile.states_regions,
        cities=profile.cities,
        work_types=profile.work_types,
        minimum_base=profile.minimum_base,
        equity_preference=profile.equity_preference,
        relocation_preference=profile.relocation_preference,
        travel_max_percent=profile.travel_max_percent,
    )


def resolve_criteria(session: Session, share: SharedSearch) -> MatchCriteria | None:
    """None only for a still-`awaiting_input` share with neither a profile
    nor criteria set yet."""
    if share.source_profile_id:
        profile = session.get(CareerProfile, share.source_profile_id)
        return _criteria_from_profile(profile) if profile else None
    if share.criteria:
        return criteria_from_dict(share.criteria, name=share.friend_label or "this search")
    return None


def generate_slug(session: Session) -> str:
    """An opaque, unguessable slug -- unlike CareerPage's vanity slugs, a
    share link is never meant to be memorable or hand-typed, so a random
    token (the same approach TestimonialRequest's invitation token uses)
    is simpler than name-derived slug suggestion plus collision handling."""
    while True:
        candidate = secrets.token_urlsafe(6).lower().replace("_", "-").replace("=", "")
        if not session.exec(select(SharedSearch).where(SharedSearch.slug == candidate)).first():
            return candidate


async def generate_digest(criteria: MatchCriteria, *, limit: int = DIGEST_LIMIT) -> list[dict]:
    aggregate = await aggregate_job_search(build_ats_queries(criteria))
    scored: list[dict] = []
    for discovered in web_results_to_jobs(aggregate["results"]):
        job = Job(**normalize_discovered(discovered))
        if is_out_of_scope(job, criteria):
            continue
        score, strengths, _gaps = deterministic_match(job, criteria)
        scored.append({
            "title": job.title,
            "company": job.company,
            "location": job.location,
            "url": job.url,
            "score": score,
            "strengths": strengths[:3],
        })
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:limit]


async def refresh_if_stale(
    session: Session,
    share: SharedSearch,
    *,
    min_interval: timedelta = DEFAULT_MIN_REFRESH_INTERVAL,
    force: bool = False,
) -> SharedSearch:
    stale = share.last_refreshed_at is None or (utcnow() - share.last_refreshed_at) >= min_interval
    if not (force or stale):
        return share
    criteria = resolve_criteria(session, share)
    if criteria is None:
        return share
    share.last_digest = await generate_digest(criteria)
    share.last_refreshed_at = utcnow()
    session.add(share)
    session.commit()
    session.refresh(share)
    return share
