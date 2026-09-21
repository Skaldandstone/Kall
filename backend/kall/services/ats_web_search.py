from urllib.parse import quote_plus

from kall.models import CareerProfile
from kall.services.functional_areas import functional_area_terms

ATS_DOMAINS = [
    ("Ashby", "jobs.ashbyhq.com"),
    ("Greenhouse", "boards.greenhouse.io"),
    ("Lever", "jobs.lever.co"),
    ("iCIMS", "careers.icims.com"),
    ("Jobvite", "jobs.jobvite.com"),
    ("Workday", "myworkdayjobs.com"),
    ("BambooHR", "jobs.bamboohr.com"),
    ("SmartRecruiters", "jobs.smartrecruiters.com"),
    ("JazzHR", "apply.jazz.co"),
    ("Workable", "careers.workable.com"),
]

#: Job boards and aggregators, distinct from ATS_DOMAINS above (where a
#: specific employer's own posting actually lives). Mostly remote-focused,
#: since that is what these boards specialize in -- added at the user's
#: request to widen the same hidden-market site: search every discovery run
#: and the search workspace already build from ATS_DOMAINS.
JOB_BOARD_DOMAINS = [
    ("Remote.co", "remote.co"),
    ("We Work Remotely", "weworkremotely.com"),
    ("FlexJobs", "flexjobs.com"),
    ("Remotive", "remotive.com"),
    ("Remote OK", "remoteok.com"),
    ("JustRemote", "justremote.com"),
    ("Jobspresso", "jobspresso.co"),
    ("Dynamite Jobs", "dynamitejobs.com"),
    ("NoDesk", "nodesk.co"),
    ("Himalayas", "himalayas.app"),
    ("Wellfound", "wellfound.com"),
    ("DailyRemote", "dailyremote.com"),
    ("Landing.Jobs", "landingjobs.io"),
    ("Hubstaff Talent", "hubstaff.com/jobs"),
    ("Jobicy", "jobicy.com"),
    ("Authentic Jobs", "authenticjobs.com"),
    ("Jobot", "jobot.com"),
    ("Arc.dev", "arc.dev"),
    ("Workew", "workew.com"),
    ("Remote Rocketship", "remoterocketship.com"),
    ("Remote.io", "remote.io"),
    ("JobsConsult", "jobsconsult.com"),
    ("Skip The Drive", "skipthedrive.com"),
    ("Crossover", "crossover.com"),
    ("Working Nomads", "workingnomads.com"),
    ("EuroRemoteJobs", "euromotejobs.com"),
    ("4 Day Week", "4dayweek.io"),
    ("Turing", "turing.com"),
    ("ASGC", "jobs.asgc.gg"),
    ("Speedrun Talent Network", "speedrun-talent-network.com"),
]

#: Professional-association career centers, added because JOB_BOARD_DOMAINS
#: above is entirely general/remote-work boards with no non-tech vertical
#: coverage -- a lawyer, HR professional, or accountant target title never
#: matched a listing this hidden-market search could find. Each domain was
#: visited directly to confirm real, public, un-gated listings at a stable
#: `/job/{slug}/{id}/` path (same platform underlies all three), not just a
#: marketing page -- the same bar ATS_DOMAINS/JOB_BOARD_DOMAINS entries meet.
PROFESSIONAL_ASSOCIATION_DOMAINS = [
    ("American Bar Association Career Center", "jobs.americanbar.org"),
    ("SHRM Job Board", "jobs.shrm.org"),
    ("AFWA Career Center", "jobs.afwa.org"),
]

ALL_SEARCH_DOMAINS = ATS_DOMAINS + JOB_BOARD_DOMAINS + PROFESSIONAL_ASSOCIATION_DOMAINS


def _quoted_or(values: list[str], limit: int = 8, prefix: str = "") -> str:
    cleaned = [value.strip() for value in values if value and value.strip()]
    return " OR ".join(f'{prefix}"{value}"' for value in cleaned[:limit])


def build_search_intent(profile: CareerProfile) -> str:
    """The title/industry/keyword/location boolean, with no site: clause.

    Kept separate from build_ats_queries below because it is the one thing
    every per-site query shares -- discovery.py records this on SearchRun as
    what a run actually searched for, since there is no longer one merged
    query to point to.
    """
    # Areas broaden the title group. An AND clause would instead exclude
    # related roles that use a different title, which defeats the feature.
    # intitle: (repeated per Google's own syntax for grouping it with OR)
    # keeps this matching an individual posting's own page title rather than
    # a company's aggregate "{Company} - Jobs" listing page -- that page
    # contains nearly every OR'd term somewhere in its body text (it lists
    # every open role) and out-ranks any single posting for a broad query,
    # which is why every site search result page was one of those instead of
    # an actual open role.
    titles = _quoted_or(
        [*profile.target_titles[:8], *functional_area_terms(profile.functional_areas)],
        limit=8, prefix="intitle:",
    )
    industries = _quoted_or(profile.industries, limit=5)
    keywords = _quoted_or(profile.include_keywords, limit=5)
    locations = _quoted_or([*profile.states_regions, *profile.countries], limit=5)
    exclusions = " ".join(f'-"{value.strip()}"' for value in profile.exclude_keywords[:5] if value.strip())

    intent_parts = []
    if titles:
        intent_parts.append(f"({titles})")
    # A title like "Quality Assurance Director" alone pulls in every industry
    # that title exists in (software, pharma, food safety, ...) -- profile
    # already stored the chosen industries (CareerProfile.industries) and
    # deterministic_match already scores by it for structured providers, but
    # this hidden-market query never narrowed by it at all.
    if industries:
        intent_parts.append(f"({industries})")
    if keywords:
        intent_parts.append(f"({keywords})")
    if locations:
        intent_parts.append(f"({locations})")
    if "remote" in {str(value).lower() for value in profile.work_types}:
        intent_parts.append('(remote OR "work from home")')
    if exclusions:
        intent_parts.append(exclusions)

    return " ".join(intent_parts).strip() or f'"{profile.name}"'


def build_ats_queries(profile: CareerProfile) -> list[dict[str, object]]:
    """One real, independently runnable search per site -- not all sites
    OR'd into a single query.

    Google (both classic search and the Programmable Search Engine widget
    the search workspace embeds) stops processing a query after roughly 32
    words. OR-ing all ~39 site: domains together alone used up that entire
    budget, so the actual title/location/keyword boolean after it was
    silently dropped -- the search behaved as if only the site: clause had
    been sent, which is indistinguishable from browsing each board's
    homepage. One site: term per query leaves the whole budget for the
    boolean that actually matters.
    """
    intent = build_search_intent(profile)
    queries = []
    for provider, domain in ALL_SEARCH_DOMAINS:
        query = f"site:{domain} {intent}".strip()
        queries.append({
            "provider": provider,
            "domain": domain,
            "query": query,
            "google_url": f"https://www.google.com/search?q={quote_plus(query)}",
            "bing_url": f"https://www.bing.com/search?q={quote_plus(query)}",
        })
    return queries
