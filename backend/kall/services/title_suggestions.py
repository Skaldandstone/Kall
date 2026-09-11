"""Suggest close variants of job titles someone has already approved.

Job boards phrase the same role many ways ("Director of QE", "Head of Quality
Engineering", "QA Director"), and a search that matches on exact title text
misses every spelling the person did not think of. This turns each confirmed
title into its near-synonyms so the guided profile can offer them one tap at
a time instead of a single fixed list.

The rules-based expansion is deliberately small and explicit; the AI variant
is used only to add to it and never replaces it.
"""

import re

from kall.config import get_settings
from kall.services.functional_areas import normalized_phrase
from kall.services.openai_json import ask_for_json

# Interchangeable domain phrases. Every phrase in a group is a synonym for
# the others when it appears as the subject of a title.
_DOMAIN_GROUPS: tuple[tuple[str, ...], ...] = (
    ("Quality Engineering", "QE", "Quality Assurance", "QA", "Software Quality", "Test Engineering", "Software Quality Engineering", "Product Quality"),
    ("Software Engineering", "Engineering", "Software Development"),
    ("Product Management", "Product"),
    ("Data Science", "Machine Learning", "Applied Science"),
    ("Data Engineering", "Data Platform", "Analytics Engineering"),
    ("Design", "Product Design", "UX", "User Experience"),
    ("Sales", "Revenue", "Business Development"),
    ("Marketing", "Growth Marketing", "Demand Generation"),
    ("Operations", "Business Operations"),
    ("Security", "Information Security", "Cybersecurity"),
    ("Customer Success", "Customer Experience", "Client Success"),
    ("Human Resources", "People", "People Operations", "Talent"),
)

# Individual-contributor role phrases that boards use interchangeably.
_ROLE_GROUPS: tuple[tuple[str, ...], ...] = (
    ("Software Engineer", "Software Developer", "Application Engineer", "Programmer"),
    ("QA Engineer", "Quality Engineer", "Test Engineer", "SDET", "Quality Assurance Engineer", "Test Automation Engineer"),
    ("QA Analyst", "Quality Assurance Analyst", "Test Analyst"),
    ("Data Scientist", "Machine Learning Engineer", "Applied Scientist"),
    ("Data Engineer", "Analytics Engineer", "Data Platform Engineer"),
    ("Product Manager", "Product Owner", "Product Lead"),
    ("Product Designer", "UX Designer", "Interaction Designer"),
    ("Account Executive", "Sales Executive", "Business Development Manager"),
    ("Customer Success Manager", "Client Success Manager", "Account Manager"),
    ("Recruiter", "Talent Acquisition Partner", "Technical Recruiter"),
    ("Security Engineer", "Information Security Engineer", "Cybersecurity Engineer"),
)

# Leadership levels that describe comparable scope. A title at one level is
# offered at the others in its band, never across bands (a manager is not
# offered "VP").
_LEVEL_BANDS: tuple[tuple[str, ...], ...] = (
    ("Director", "Head", "Senior Director"),
    ("Manager", "Lead", "Senior Manager"),
    ("VP", "Vice President", "Head"),
    ("Chief", "Head"),
)

_LEVEL_PATTERN = re.compile(
    r"^(?P<level>Senior Director|Senior Manager|Vice President|Director|Head|VP|Manager|Lead|Chief)"
    r"(?:\s+of)?\s+(?P<domain>.+)$",
    re.IGNORECASE,
)
_SUFFIX_PATTERN = re.compile(r"^(?P<domain>.+?)\s+(?P<level>Director|Manager|Lead|Head)$", re.IGNORECASE)


def _canonical_level(level: str) -> str:
    for band in _LEVEL_BANDS:
        for entry in band:
            if normalized_phrase(entry) == normalized_phrase(level):
                return entry
    return level


def _domain_variants(domain: str) -> list[str]:
    key = normalized_phrase(domain)
    for group in _DOMAIN_GROUPS:
        if any(normalized_phrase(entry) == key for entry in group):
            return [entry for entry in group if normalized_phrase(entry) != key]
    return []


def _levels_like(level: str) -> list[str]:
    canonical = _canonical_level(level)
    levels: list[str] = []
    for band in _LEVEL_BANDS:
        if canonical in band:
            levels.extend(entry for entry in band if entry != canonical)
    return levels


def _compose(level: str, domain: str) -> list[str]:
    """The phrasings boards actually use for a level + domain pair."""
    if level == "Lead":
        return [f"{domain} Lead"]
    if level == "Senior Manager":
        return [f"Senior {domain} Manager"]
    if level == "Manager":
        return [f"{domain} Manager", f"Manager of {domain}"]
    if level == "Director":
        return [f"Director of {domain}", f"{domain} Director"]
    return [f"{level} of {domain}"]


def _swap_phrase(text: str, groups: tuple[tuple[str, ...], ...]) -> list[str]:
    """Replace the first recognised phrase in `text` with each of its
    synonyms, keeping the rest of the title (seniority, qualifiers) intact."""
    for group in groups:
        for entry in sorted(group, key=len, reverse=True):
            pattern = re.compile(rf"\b{re.escape(entry)}\b", re.IGNORECASE)
            if pattern.search(text):
                return [pattern.sub(alt, text) for alt in group if normalized_phrase(alt) != normalized_phrase(entry)]
    return []


def _variants_for(title: str) -> list[str]:
    """Ordered candidates for one title: comparable levels first (the
    variants a person most often forgets), then synonymous domains, then a
    couple of cross combinations, then phrase swaps for IC titles."""
    text = " ".join((title or "").split())
    if not text:
        return []
    candidates: list[str] = []
    # A known IC role ("Product Manager", "QA Engineer") is a phrase in its
    # own right; its synonyms come first and it is not split into level +
    # domain, which would manufacture titles nobody posts.
    role_swaps = _swap_phrase(text, _ROLE_GROUPS)
    candidates.extend(role_swaps)
    match = None if role_swaps else (_LEVEL_PATTERN.match(text) or _SUFFIX_PATTERN.match(text))
    if match:
        level = _canonical_level(match.group("level"))
        domain = match.group("domain").strip()
        for alt_level in _levels_like(level):
            candidates.extend(_compose(alt_level, domain))
        for alt_domain in _domain_variants(domain):
            candidates.extend(_compose(level, alt_domain))
        for alt_level in _levels_like(level)[:1]:
            for alt_domain in _domain_variants(domain)[:2]:
                candidates.extend(_compose(alt_level, alt_domain))
    if not role_swaps and not match:
        candidates.extend(_swap_phrase(text, _DOMAIN_GROUPS))
    return candidates


def related_titles(titles: list[str], exclude: list[str] | None = None, limit: int = 12) -> list[str]:
    """Rules-based close variants of the given titles, interleaved so every
    confirmed title contributes, without any title already in `titles` or
    `exclude`."""
    seen = {normalized_phrase(value) for value in [*titles, *(exclude or [])] if value}
    per_title = [_variants_for(title) for title in titles]
    results: list[str] = []
    for round_index in range(max((len(items) for items in per_title), default=0)):
        for items in per_title:
            if round_index >= len(items):
                continue
            candidate = " ".join(items[round_index].split())
            key = normalized_phrase(candidate)
            if key and key not in seen:
                seen.add(key)
                results.append(candidate)
            if len(results) >= limit:
                return results
    return results


_RELATED_SCHEMA = {
    "type": "object",
    "properties": {"titles": {"type": "array", "maxItems": 8, "items": {"type": "string"}}},
    "required": ["titles"],
    "additionalProperties": False,
}


def ai_related_titles(titles: list[str], exclude: list[str] | None = None) -> list[str]:
    """Model-suggested variants layered on top of related_titles(); empty when
    no key is configured or the call fails. Never returns a title the caller
    already has."""
    settings = get_settings()
    confirmed = [value for value in titles if value and value.strip()]
    if not settings.openai_api_key or not confirmed:
        return []
    known = {normalized_phrase(value) for value in [*confirmed, *(exclude or [])]}
    prompt = (
        "A job seeker approved these job titles for a search: "
        + "; ".join(confirmed)
        + ". Suggest up to 8 additional titles that job boards use for the SAME role and seniority "
        "(synonyms, common abbreviations, and equivalent phrasings), so a search on exact title text "
        "does not miss postings. Do not suggest promotions, demotions, or different functions, and do "
        "not repeat a title already listed."
    )
    result = ask_for_json(prompt, schema_name="related_job_titles", schema=_RELATED_SCHEMA, purpose="related job titles")
    if not result:
        return []
    offered: list[str] = []
    for value in result.get("titles") or []:
        key = normalized_phrase(str(value))
        if key and key not in known:
            known.add(key)
            offered.append(" ".join(str(value).split()))
    return offered
