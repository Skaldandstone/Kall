import re

from kall.models.core import CareerProfile, Job

#: A posting mentioning any of these is treated as disclosing equity/stock
#: compensation. Job has no structured equity field (postings rarely state a
#: number the way they do a salary range), so this is a text-mention signal
#: like salary_from_text below, not a parsed amount.
_EQUITY_SIGNALS = ("equity", "stock option", "rsu", "restricted stock", "equity compensation")


def mentions_equity(text: str) -> bool:
    """True if any equity-related phrase appears anywhere in `text`.

    A plain substring match -- like salary_from_text, this does not parse
    negation ("no equity offered" still matches "equity"). Good enough as a
    soft signal; not a claim that equity was actually offered.
    """
    lower = text.lower()
    return any(signal in lower for signal in _EQUITY_SIGNALS)


def excluded_keyword_hit(job: Job, profile: CareerProfile) -> str | None:
    text = f"{job.title} {job.description}".casefold()
    hits = [k for k in profile.exclude_keywords if k.casefold() in text]
    return hits[0] if hits else None


def location_out_of_scope(job: Job, profile: CareerProfile) -> bool:
    allowed = [*profile.countries, *profile.states_regions]
    if not allowed:
        return False
    location_text = " ".join(filter(None, [job.location, job.country, job.state_region])).casefold()
    if not location_text.strip():
        # Unknown location: don't reject for missing data, only for a confirmed mismatch.
        return False
    return not any(term.casefold() in location_text for term in allowed)


def is_out_of_scope(job: Job, profile: CareerProfile) -> str | None:
    """Hard search-parameter constraints. Returns a human-readable reason if the job
    should never be surfaced to this profile, or None if it's in scope.

    Unlike deterministic_match (which only scores relevance), a positive result here
    means the job must not be shown for this profile at all — it violates an explicit
    exclude-keyword or location constraint the user set."""
    hit = excluded_keyword_hit(job, profile)
    if hit:
        return f"Contains excluded keyword: {hit}"
    if location_out_of_scope(job, profile):
        return "Location outside specified countries/regions"
    return None


def deterministic_match(job: Job, profile: CareerProfile) -> tuple[int, list[str], list[str]]:
    text = f"{job.title} {job.description}".lower()
    score = 0
    strengths: list[str] = []
    gaps: list[str] = []

    title_hits = [title for title in profile.target_titles if title.lower() in job.title.lower()]
    if title_hits:
        score += 35
        strengths.append(f"Target-title alignment: {title_hits[0]}")

    industry_hits = [i for i in profile.industries if i.lower() in text]
    if industry_hits:
        score += 15
        strengths.append(f"Industry alignment: {industry_hits[0]}")

    keyword_hits = [k for k in profile.include_keywords if k.lower() in text]
    score += min(30, len(keyword_hits) * 10)
    strengths.extend(f"Relevant: {k}" for k in keyword_hits[:4])

    excluded = [k for k in profile.exclude_keywords if k.lower() in text]
    if excluded:
        score -= min(30, len(excluded) * 10)
        gaps.extend(f"Excluded signal: {k}" for k in excluded[:3])

    if job.work_type and job.work_type.value in profile.work_types:
        score += 10
        strengths.append(f"Work style: {job.work_type.value}")

    if profile.minimum_base and job.salary_max and job.salary_max < profile.minimum_base:
        score -= 20
        gaps.append("Maximum disclosed salary is below minimum target")
    elif profile.minimum_base and job.salary_min and job.salary_min >= profile.minimum_base:
        score += 10
        strengths.append("Compensation meets minimum target")

    if profile.equity_preference and profile.equity_preference != "not_important":
        if mentions_equity(text):
            score += 5
            strengths.append("Equity or stock compensation is mentioned in this posting")
        elif profile.equity_preference == "required":
            score -= 10
            gaps.append("No equity or stock compensation mentioned, but you require it")

    return max(0, min(100, score)), strengths, gaps


def salary_from_text(text: str) -> tuple[int | None, int | None]:
    values = [int(v.replace(",", "")) for v in re.findall(r"\$([0-9]{2,3}(?:,[0-9]{3})?)", text)]
    if not values:
        return None, None
    annual = [v * 1000 if v < 1000 else v for v in values]
    return min(annual), max(annual)
