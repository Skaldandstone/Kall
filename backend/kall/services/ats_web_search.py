from urllib.parse import quote_plus

from kall.models import CareerProfile

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
]

ALL_SEARCH_DOMAINS = ATS_DOMAINS + JOB_BOARD_DOMAINS


def _quoted_or(values: list[str], limit: int = 8) -> str:
    cleaned = [value.strip() for value in values if value and value.strip()]
    return " OR ".join(f'"{value}"' for value in cleaned[:limit])


def build_ats_queries(profile: CareerProfile) -> list[dict[str, object]]:
    titles = _quoted_or(profile.target_titles)
    keywords = _quoted_or(profile.include_keywords, limit=5)
    locations = _quoted_or([*profile.states_regions, *profile.countries], limit=5)
    exclusions = " ".join(f'-"{value.strip()}"' for value in profile.exclude_keywords[:5] if value.strip())

    intent_parts = []
    if titles:
        intent_parts.append(f"({titles})")
    if keywords:
        intent_parts.append(f"({keywords})")
    if locations:
        intent_parts.append(f"({locations})")
    if "remote" in {str(value).lower() for value in profile.work_types}:
        intent_parts.append('(remote OR "work from home")')
    if exclusions:
        intent_parts.append(exclusions)

    intent = " ".join(intent_parts).strip() or f'"{profile.name}"'
    site_clause = " OR ".join(f"site:{domain}" for _, domain in ALL_SEARCH_DOMAINS)
    query = f"({site_clause}) {intent}".strip()

    return [
        {
            "provider": "ATS Search",
            "domain": f"{len(ATS_DOMAINS)} ATS platforms and {len(JOB_BOARD_DOMAINS)} job boards",
            "domains": [domain for _, domain in ALL_SEARCH_DOMAINS],
            "providers": [provider for provider, _ in ALL_SEARCH_DOMAINS],
            "query": query,
            "google_url": f"https://www.google.com/search?q={quote_plus(query)}",
            "bing_url": f"https://www.bing.com/search?q={quote_plus(query)}",
        }
    ]
