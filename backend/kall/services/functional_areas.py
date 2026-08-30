"""Small, explicit role vocabulary shared by query expansion and match evidence.

These are search heuristics, not a classification of a person's qualifications.
Custom areas remain valid and match their own phrase. No AI call is involved.
"""

import re

FUNCTIONAL_AREA_ALIASES: dict[str, tuple[str, ...]] = {
    "Quality Engineering": ("quality assurance", "test automation", "software test engineer", "SDET"),
    "Software Engineering": ("software engineer", "software developer", "backend engineer", "frontend engineer"),
    "Product Management": ("product manager", "product owner", "product lead"),
    "Data Science": ("data scientist", "machine learning engineer", "applied scientist"),
    "Data Engineering": ("data engineer", "analytics engineer", "data platform engineer"),
    "Design": ("product designer", "UX designer", "user experience", "interaction designer"),
    "Operations": ("business operations", "operations manager", "operations analyst"),
    "Security": ("security engineer", "information security", "cybersecurity", "security analyst"),
}


def normalized_phrase(value: str) -> str:
    return " ".join(re.findall(r"\w+", value.casefold()))


def terms_for_area(area: str) -> list[str]:
    phrase = normalized_phrase(area)
    if not phrase:
        return []
    for label, aliases in FUNCTIONAL_AREA_ALIASES.items():
        if phrase in {normalized_phrase(term) for term in (label, *aliases)}:
            return [label, *aliases]
    return [" ".join(area.split())]


def functional_area_terms(areas: list[str]) -> list[str]:
    """Bound query expansion to five areas, preserving deterministic order."""
    seen: set[str] = set()
    terms = []
    for area in areas[:5]:
        for term in terms_for_area(area):
            key = normalized_phrase(term)
            if key not in seen:
                terms.append(term)
                seen.add(key)
    return terms


def functional_area_evidence(text: str, areas: list[str]) -> tuple[str, str] | None:
    """Return one selected area and matched phrase, with word boundaries."""
    haystack = f" {normalized_phrase(text)} "
    for area in areas:
        for term in terms_for_area(area):
            if f" {normalized_phrase(term)} " in haystack:
                return area.strip(), term
    return None
