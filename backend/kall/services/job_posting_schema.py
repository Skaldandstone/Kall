"""Best-effort extraction of a job posting's real description from its own
page, via the schema.org JobPosting structured data most employer career
sites already embed for Google for Jobs indexing.

This is deliberately ATS-agnostic rather than another per-provider scraper:
Greenhouse/Lever/Ashby/Workday (providers/) each need reverse-engineering
one specific board API, which only pays off for ATSes consistent enough
across customers to be worth it -- Workday's CXS endpoint qualifies; iCIMS
does not, since most iCIMS-hosted portals are customized per employer with
no single reliable API shape. JobPosting structured data sidesteps that
entirely: any employer who wants their listings surfaced by Google's job
search already publishes this on the posting page itself, regardless of
which ATS is underneath -- iCIMS, Taleo, SuccessFactors, a fully custom
career site, or the very Workday/Greenhouse pages the dedicated providers
already handle. Failure here must never block an import: this only ever
upgrades a bare snippet into real content, never the other way around.
"""

import html as html_module
import json
import re
from typing import Any

import httpx

#: Real browsers get a real response from most career sites; some block a
#: bare default HTTP-client User-Agent outright.
_USER_AGENT = "Mozilla/5.0 (compatible; KallBot/1.0; +https://kall.skaldandstone.com)"
_JSONLD_BLOCK = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_TAG = re.compile(r"<[^>]+>")
_WHITESPACE = re.compile(r"[ \t]+")
_BLANK_LINES = re.compile(r"\n{3,}")
_BLOCK_TAGS = re.compile(r"</?(?:p|div|br|li|h[1-6])[^>]*>", re.IGNORECASE)


def _strip_html(value: str) -> str:
    """JobPosting.description is typically raw HTML per the schema.org spec
    -- turn it into the same kind of plain text every other provider here
    already returns, rather than storing markup no downstream code expects."""
    text = _BLOCK_TAGS.sub("\n", value)
    text = _TAG.sub("", text)
    text = html_module.unescape(text)
    text = _WHITESPACE.sub(" ", text)
    text = _BLANK_LINES.sub("\n\n", text)
    return text.strip()


def _find_job_posting(node: Any) -> dict | None:
    """A page can embed one object, a list of objects, or a schema.org
    @graph array -- walk all three shapes for the first entry whose @type
    is (or includes) JobPosting."""
    if isinstance(node, dict):
        node_type = node.get("@type")
        types = node_type if isinstance(node_type, list) else [node_type]
        if any(str(t).lower() == "jobposting" for t in types if t):
            return node
        if "@graph" in node:
            found = _find_job_posting(node["@graph"])
            if found:
                return found
        return None
    if isinstance(node, list):
        for item in node:
            found = _find_job_posting(item)
            if found:
                return found
    return None


def extract_job_posting(page_html: str) -> dict | None:
    """The raw JobPosting dict from a page's embedded structured data, or
    None if the page has none or it doesn't parse."""
    for match in _JSONLD_BLOCK.finditer(page_html):
        raw = html_module.unescape(match.group(1)).strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        found = _find_job_posting(parsed)
        if found:
            return found
    return None


def fetch_job_posting_description(url: str, *, client: httpx.Client | None = None) -> str | None:
    """Plain-text job description from the posting's own JobPosting
    structured data, or None on anything short of full success -- a
    timeout, a non-2xx response, no embedded schema, or a description
    field that isn't a usable string. Callers must already have a
    fallback (a search snippet, typically) and treat this purely as an
    upgrade to it.
    """
    owns_client = client is None
    http_client = client or httpx.Client(timeout=8, follow_redirects=True, headers={"User-Agent": _USER_AGENT})
    try:
        response = http_client.get(url)
        if response.status_code >= 400:
            return None
        posting = extract_job_posting(response.text)
        if not posting:
            return None
        description = posting.get("description")
        if not isinstance(description, str) or not description.strip():
            return None
        return _strip_html(description) or None
    except httpx.HTTPError:
        return None
    finally:
        if owns_client:
            http_client.close()
