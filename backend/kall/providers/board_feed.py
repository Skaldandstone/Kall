"""Bounded conditional requests to the three supported public ATS APIs."""

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from urllib.parse import quote

import httpx
from kall.providers.ashby import AshbyProvider
from kall.providers.greenhouse import GreenhouseProvider
from kall.providers.jobs import DiscoveredJob, parse_iso_datetime
from kall.providers.lever import LeverProvider

PROVIDERS = {"greenhouse": GreenhouseProvider, "lever": LeverProvider, "ashby": AshbyProvider}
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_JOBS = 2000


def feed_key(provider: str, board: str) -> str:
    if provider not in PROVIDERS or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", board):
        raise ValueError("Use a supported provider and a company board slug, not a URL.")
    return hashlib.sha256(f"{provider}:{board}".encode()).hexdigest()


def encode_jobs(jobs: list[DiscoveredJob]) -> list[dict]:
    rows = []
    for job in jobs:
        row = asdict(job)
        row["posted_at"] = job.posted_at.isoformat() if job.posted_at else None
        rows.append(row)
    return rows


def decode_jobs(rows: list[dict]) -> list[DiscoveredJob]:
    return [DiscoveredJob(**{**row, "posted_at": parse_iso_datetime(row.get("posted_at"))}) for row in rows]


@dataclass
class FeedResult:
    jobs: list[dict] | None
    etag: str | None
    last_modified: str | None
    response_bytes: int


async def fetch_feed(client: httpx.AsyncClient, provider: str, board: str,
                     *, etag: str | None = None, last_modified: str | None = None) -> FeedResult:
    feed_key(provider, board)
    slug = quote(board, safe="")
    urls = {
        "greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true",
        "lever": f"https://api.lever.co/v0/postings/{slug}?mode=json",
        "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{slug}",
    }
    headers = {}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    async with client.stream("GET", urls[provider], headers=headers, follow_redirects=False) as response:
        if response.status_code == 304:
            return FeedResult(None, response.headers.get("etag", etag),
                              response.headers.get("last-modified", last_modified), 0)
        response.raise_for_status()
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ValueError("Board response exceeds the pilot's 2 MiB limit.")
        payload = json.loads(body)
        if provider == "lever":
            valid = isinstance(payload, list)
        else:
            valid = isinstance(payload, dict) and isinstance(payload.get("jobs"), list)
        if not valid:
            raise ValueError("Malformed board response.")
        try:
            jobs = PROVIDERS[provider]().parse(payload, board)
        except (TypeError, AttributeError) as error:
            raise ValueError("Malformed posting in board response.") from error
        if len(jobs) > MAX_JOBS:
            raise ValueError("Board exceeds the pilot's 2000-posting limit.")
        return FeedResult(encode_jobs(jobs), response.headers.get("etag"),
                          response.headers.get("last-modified"), len(body))


def content_version(jobs: list[dict]) -> str:
    return hashlib.sha256(json.dumps(jobs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
