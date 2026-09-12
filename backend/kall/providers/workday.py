"""Workday-hosted career sites (CXS API).

Unlike Greenhouse/Lever/Ashby, Workday has no single documented public
board API -- this targets the JSON endpoint every Workday-hosted career
site's own frontend calls internally (widely relied on by job-aggregation
tools, though not an endpoint Workday publishes or guarantees). A tenant's
site lives at `https://<tenant>.<wdN>.myworkdayjobs.com/<site>`; the CXS API
mirrors that path under `/wday/cxs/<tenant>/<site>/...`.

Workday matters specifically for non-software industries: it is the ATS
behind a large share of retail, healthcare, and hospitality employers that
Greenhouse/Lever/Ashby (startup/tech-oriented) never reach.

The list endpoint returns title/location/a relative posting age string, but
never the actual job description -- unlike Greenhouse, which returns full
content in one call. Getting real description text (needed for keyword
matching and tailoring) takes one further request per posting, so a
company's board key set here means one list call plus one call per posting
returned, not the single call the other three providers make.
"""

import re

import httpx
from kall.providers.jobs import DiscoveredJob

#: How many postings to request per page. Workday's own career sites
#: typically page at 20; asking for more in one call is accepted by the API
#: but keeps this conservative to avoid an unusually large single response
#: for a big employer's board.
_PAGE_SIZE = 20
#: A hard ceiling on postings fetched per company per run, so one very large
#: employer's board cannot turn a single discovery run into hundreds of
#: description fetches.
_MAX_POSTINGS = 60


def _parse_board_key(board_key: str) -> tuple[str, str, str]:
    """(host, tenant, site) from a board key shaped like a Workday career
    site's own URL, e.g. "acme.wd5.myworkdayjobs.com/External" or with a
    leading scheme -- both are accepted so pasting the address bar URL
    works without editing it first."""
    cleaned = re.sub(r"^https?://", "", board_key.strip()).strip("/")
    host, _, site = cleaned.partition("/")
    tenant = host.split(".", 1)[0]
    return host, tenant, (site or "External")


class WorkdayProvider:
    name = "workday"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client

    async def collect(self, company_name: str, board_key: str) -> list[DiscoveredJob]:
        host, tenant, site = _parse_board_key(board_key)
        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=20)
        try:
            listing = await client.post(
                f"https://{host}/wday/cxs/{tenant}/{site}/jobs",
                json={"appliedFacets": {}, "limit": _PAGE_SIZE, "offset": 0, "searchText": ""},
            )
            listing.raise_for_status()
            postings = listing.json().get("jobPostings", [])[:_MAX_POSTINGS]
            rows = []
            for item in postings:
                path = item.get("externalPath") or ""
                description = await self._fetch_description(client, host, tenant, site, path)
                rows.append(DiscoveredJob(
                    source=self.name,
                    external_id=item.get("bulletFields", [None])[0] if item.get("bulletFields") else path or None,
                    company=company_name,
                    title=item.get("title", ""),
                    description=description or item.get("title", ""),
                    url=f"https://{host}/{site}{path}",
                    location=item.get("locationsText"),
                    # Workday's list endpoint gives a relative age string
                    # ("Posted 3 Days Ago"), not a parseable timestamp -- no
                    # posted_at rather than a guessed, possibly wrong date.
                    posted_at=None,
                    metadata={"job_req_id": item.get("bulletFields", [None])[0] if item.get("bulletFields") else None},
                ))
            return rows
        finally:
            if owns_client:
                await client.aclose()

    async def _fetch_description(self, client: httpx.AsyncClient, host: str, tenant: str, site: str, path: str) -> str:
        """The list endpoint has no description; each posting needs its own
        detail call. Failing here should drop the description, never the
        whole board -- one malformed posting must not blank out every other
        job a real company has open."""
        if not path:
            return ""
        try:
            # externalPath already starts with "/job/...", so it appends
            # directly onto the CXS base -- no extra "/job" segment here.
            response = await client.post(f"https://{host}/wday/cxs/{tenant}/{site}{path}")
            response.raise_for_status()
            info = response.json().get("jobPostingInfo", {})
            return info.get("jobDescription", "") or ""
        except httpx.HTTPError:
            return ""
