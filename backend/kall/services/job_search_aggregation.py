import asyncio

import httpx
from kall.config import get_settings

GOOGLE_CUSTOM_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
#: Bounds how many of the (up to 39) per-site queries run concurrently, so
#: one search does not open dozens of simultaneous connections at once.
_CONCURRENCY = 10


async def _fetch_one(client: httpx.AsyncClient, query: str, api_key: str, engine_id: str) -> tuple[bool, list[dict]]:
    """(ok, results). ok is False only for a real failure (network error,
    non-200, quota exhausted) -- a genuinely empty result set for a site with
    no matching postings right now is not a failure and must not be counted
    as one."""
    try:
        response = await client.get(GOOGLE_CUSTOM_SEARCH_URL, params={
            "key": api_key, "cx": engine_id, "q": query, "num": 10,
        })
    except httpx.HTTPError:
        return False, []
    if response.status_code != 200:
        return False, []
    items = response.json().get("items") or []
    return True, [
        {"title": item.get("title", ""), "url": item.get("link", ""), "snippet": item.get("snippet", "")}
        for item in items
        if item.get("link")
    ]


async def aggregate_job_search(queries: list[dict], *, client: httpx.AsyncClient | None = None) -> dict:
    """Runs every per-site query from ats_web_search.build_ats_queries against
    Google's Custom Search JSON API in parallel and returns one deduplicated,
    combined result list -- this is what lets a single "Search jobs" click
    populate every site's results at once, instead of paging through 39
    separate searches by hand (see GoogleJobSearchResults, the free
    client-side widget this upgrades on top of).

    Returns enabled=False with no results when no API key is configured, so
    a caller can fall back to the widget rather than show an empty page.
    """
    settings = get_settings()
    api_key = settings.google_custom_search_api_key
    engine_id = settings.google_custom_search_engine_id
    if not api_key or not engine_id:
        return {"enabled": False, "results": [], "sites_searched": 0, "sites_failed": 0}

    semaphore = asyncio.Semaphore(_CONCURRENCY)

    async def bounded_fetch(http_client: httpx.AsyncClient, item: dict) -> tuple[dict, bool, list[dict]]:
        async with semaphore:
            ok, results = await _fetch_one(http_client, item["query"], api_key, engine_id)
            return item, ok, results

    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=15)
    try:
        outcomes = await asyncio.gather(*(bounded_fetch(http_client, item) for item in queries))
    finally:
        if owns_client:
            await http_client.aclose()

    seen_urls: set[str] = set()
    results: list[dict] = []
    failed = 0
    for item, ok, items in outcomes:
        if not ok:
            failed += 1
            continue
        for result in items:
            url = result["url"]
            if url in seen_urls:
                continue
            seen_urls.add(url)
            results.append({**result, "provider": item["provider"], "domain": item["domain"]})

    return {"enabled": True, "results": results, "sites_searched": len(queries), "sites_failed": failed}
