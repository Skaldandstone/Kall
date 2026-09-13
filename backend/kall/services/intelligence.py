import re
from collections import Counter
from typing import Any

from kall.clock import utcnow

SECTION_NAMES = {
    "summary", "experience", "employment", "skills", "education", "certifications",
    "awards", "publications", "projects", "leadership", "professional experience",
}
#: A conservative vocabulary for "this line names a job, not a company or a
#: bullet point" -- used only to decide whether a line next to a date range
#: is worth surfacing as a title candidate. Deliberately broad rather than an
#: exhaustive title list, since a resume's actual title wording varies far
#: more than this could ever enumerate.
_TITLE_WORDS = {
    "engineer", "engineering", "manager", "management", "director", "lead", "head",
    "officer", "specialist", "coordinator", "analyst", "consultant", "architect",
    "developer", "designer", "scientist", "administrator", "president", "executive",
    "supervisor", "technician", "representative", "associate", "chief", "strategist",
    "recruiter", "controller", "accountant", "attorney", "counsel", "nurse", "physician",
    "teacher", "professor", "researcher", "producer", "editor", "planner", "auditor",
    "vp", "svp", "evp",
}
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*"
_DATE_RANGE = re.compile(
    rf"(?:{_MONTH})?(?P<start_year>(?:19|20)\d{{2}})\s*(?:[-–—]|to)\s*"
    rf"(?:(?P<end_word>present|current|now)|(?:{_MONTH})?(?P<end_year>(?:19|20)\d{{2}}))",
    re.IGNORECASE,
)
SKILL_TERMS = {
    "python", "java", "javascript", "typescript", "go", "aws", "azure", "gcp",
    "docker", "kubernetes", "terraform", "jenkins", "github", "gitlab", "selenium",
    "playwright", "cypress", "appium", "pytest", "sql", "api", "ci/cd", "devops",
    "saas", "security", "quality engineering", "machine learning", "artificial intelligence",
    # Retail, food service, and hospitality -- multi-word or distinctive enough
    # not to collide with unrelated substrings, matching this set's existing
    # "small and unambiguous" constraint (see skill_vocabulary.py's much
    # larger whole-term vocabulary for the broader, exact-match list).
    "point of sale", "cash handling", "inventory management", "food safety",
    "servsafe", "guest service", "housekeeping",
    # Skilled trades and industrial
    "forklift", "osha", "hvac", "welding", "blueprint reading",
    "commercial driver's license", "warehouse operations", "supply chain",
    # Aviation
    "commercial pilot license", "instrument rating", "faa", "air traffic control",
    # Healthcare
    "patient care", "hipaa", "phlebotomy", "medical billing", "medical coding",
    "electronic health records",
    # Sales and customer service
    "customer service", "lead generation", "account management", "crm",
}
LEADERSHIP_TERMS = {"director", "head", "manager", "lead", "strategy", "organization", "team", "executive"}

#: A plain `term in text` substring check false-positives badly on short
#: terms -- "go" (the language) matches inside "going", "growing",
#: "together", and so on, which silently poisons required_skills/
#: preferred_skills with a term the posting never actually mentioned. Word
#: boundaries fix this without having to hand-curate every short term out
#: of SKILL_TERMS/LEADERSHIP_TERMS.
_TERM_PATTERN_CACHE: dict[str, re.Pattern[str]] = {}


def _contains_term(text: str, term: str) -> bool:
    pattern = _TERM_PATTERN_CACHE.get(term)
    if pattern is None:
        pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
        _TERM_PATTERN_CACHE[term] = pattern
    return pattern.search(text) is not None


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.replace("\r", "").split("\n") if line.strip()]


def _metrics(text: str) -> list[str]:
    pattern = r"(?:\$\s?\d[\d,.]*|\b\d+(?:\.\d+)?%|\b\d[\d,]*\+?\b)"
    return list(dict.fromkeys(re.findall(pattern, text)))


def _looks_like_title(line: str) -> str | None:
    cleaned = _DATE_RANGE.sub("", line).strip(" \t-–—|,.")
    if not (3 <= len(cleaned) <= 80):
        return None
    return cleaned if any(word in cleaned.lower() for word in _TITLE_WORDS) else None


def employment_history(lines: list[str]) -> tuple[list[str], int | None]:
    """Role titles paired with a date range, and the resulting career span.

    Deliberately conservative: only a title-like line sitting next to a real
    date range counts, so a random line mentioning "engineer" without a date
    beside it is never surfaced. A wrong title pre-filled with unearned
    confidence is worse than the onboarding form asking the person directly.
    """
    titles: list[str] = []
    seen: set[str] = set()
    earliest_year: int | None = None
    latest_year: int | None = None
    current_year = utcnow().year

    for index, line in enumerate(lines):
        match = _DATE_RANGE.search(line)
        if not match:
            continue
        start_year = int(match.group("start_year"))
        if not (1950 <= start_year <= current_year + 1):
            continue
        end_year = int(match.group("end_year")) if match.group("end_year") else current_year
        earliest_year = start_year if earliest_year is None else min(earliest_year, start_year)
        latest_year = end_year if latest_year is None else max(latest_year, end_year)

        neighbors = [line, lines[index - 1] if index > 0 else "", lines[index + 1] if index + 1 < len(lines) else ""]
        for neighbor in neighbors:
            title = _looks_like_title(neighbor)
            if title and title.casefold() not in seen:
                seen.add(title.casefold())
                titles.append(title)
                break

    years_of_experience = (latest_year - earliest_year) if earliest_year is not None and latest_year is not None else None
    return titles, years_of_experience


def parse_resume(text: str) -> tuple[dict[str, Any], list[str]]:
    lines = _lines(text)
    sections: dict[str, list[str]] = {"unclassified": []}
    current = "unclassified"
    for line in lines:
        normalized = line.lower().rstrip(":")
        if normalized in SECTION_NAMES or (len(line) < 40 and line.isupper()):
            current = normalized
            sections.setdefault(current, [])
        else:
            sections.setdefault(current, []).append(line)

    skills = sorted({term for term in SKILL_TERMS if _contains_term(text, term)})
    achievements = []
    for line in lines:
        if len(line) >= 35 and _metrics(line):
            achievements.append({"text": line, "metrics": _metrics(line), "skills": [s for s in skills if _contains_term(line, s)]})

    role_titles, years_of_experience = employment_history(lines)
    dates = re.findall(r"\b(?:19|20)\d{2}\b", text)
    warnings = []
    if not achievements:
        warnings.append("No metric-bearing achievements were detected.")
    if not skills:
        warnings.append("No known skills were detected; review extracted text.")
    return {
        "sections": sections,
        "skills": skills,
        "achievements": achievements,
        "role_titles": role_titles,
        "years_of_experience": years_of_experience,
        "years_mentioned": sorted(set(dates)),
        "line_count": len(lines),
    }, warnings


def analyze_job(text: str) -> dict[str, list[str]]:
    lines = _lines(text)
    lower = text.lower()
    required, preferred, responsibilities = [], [], []
    for line in lines:
        value = line.lower()
        if any(x in value for x in ("required", "must have", "minimum qualification")):
            required.append(line)
        elif any(x in value for x in ("preferred", "nice to have", "bonus")):
            preferred.append(line)
        elif any(x in value for x in ("responsible", "you will", "what you'll do", "duties")):
            responsibilities.append(line)
    required_skills = sorted({term for term in SKILL_TERMS if any(_contains_term(item, term) for item in required)})
    preferred_skills = sorted({term for term in SKILL_TERMS if any(_contains_term(item, term) for item in preferred)})
    all_skills = sorted({term for term in SKILL_TERMS if _contains_term(text, term)})
    leadership = sorted({term for term in LEADERSHIP_TERMS if _contains_term(text, term)})
    words = re.findall(r"[a-z][a-z0-9+.#/-]{2,}", lower)
    keywords = [word for word, _ in Counter(words).most_common(30) if word not in {"the", "and", "with", "for", "you", "our", "this", "that"}]
    return {
        "required_skills": required_skills,
        "preferred_skills": preferred_skills,
        "responsibilities": responsibilities[:20],
        "leadership_signals": leadership,
        "education_requirements": [line for line in lines if any(x in line.lower() for x in ("degree", "bachelor", "master", "phd"))][:10],
        "certification_requirements": [line for line in lines if "certif" in line.lower()][:10],
        "ats_keywords": list(dict.fromkeys(all_skills + keywords))[:40],
        "explicit_requirements": (required + preferred)[:30],
        "inferred_signals": [f"Leadership emphasis: {x}" for x in leadership],
    }
