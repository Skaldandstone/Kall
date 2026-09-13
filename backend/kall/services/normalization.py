import hashlib
import re

from kall.models.enums import WorkType
from kall.providers.jobs import DiscoveredJob
from kall.services.matching import salary_from_text

#: Block-level tags become a line break rather than disappearing outright --
#: collapsing them straight to a space (the old behavior) flattened an entire
#: job description's paragraphs and bullet points into one giant line with no
#: newlines at all, which analyze_job() (intelligence.py) relies on to split
#: a posting into individual requirement/responsibility lines. A description
#: with no newlines becomes either one all-or-nothing "requirement" (if the
#: word appears anywhere) or none, and any per-line keyword extraction pulls
#: from wherever that one giant line happens to start rather than the actual
#: requirement bullets.
_BLOCK_TAGS = re.compile(r"</?(?:p|div|br|li|h[1-6]|ul|ol)[^>]*>", re.IGNORECASE)
_INLINE_TAG = re.compile(r"<[^>]+>")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = _BLOCK_TAGS.sub("\n", value)
    value = _INLINE_TAG.sub(" ", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def fingerprint(job: DiscoveredJob) -> str:
    key = "|".join([
        job.company.casefold().strip(),
        clean_text(job.title).casefold(),
        job.url.split("?")[0].casefold().strip(),
    ])
    return hashlib.sha256(key.encode()).hexdigest()


def infer_work_type(location: str | None, description: str) -> WorkType | None:
    text=f"{location or ''} {description}".casefold()
    if "hybrid" in text:
        return WorkType.HYBRID
    if any(x in text for x in ["remote", "distributed", "work from home"]):
        return WorkType.REMOTE
    if location:
        return WorkType.ONSITE
    return None


def normalize_discovered(job: DiscoveredJob) -> dict:
    description=clean_text(job.description)
    salary_min,salary_max=salary_from_text(description)
    return {
        "source": job.source,
        "external_id": job.external_id,
        "company": clean_text(job.company),
        "title": clean_text(job.title),
        "description": description,
        "url": job.url.split("?")[0],
        "location": clean_text(job.location),
        "work_type": infer_work_type(job.location, description),
        "salary_min": salary_min,
        "salary_max": salary_max,
        "posted_at": job.posted_at,
        "metadata_json": {**job.metadata, "fingerprint": fingerprint(job)},
    }
