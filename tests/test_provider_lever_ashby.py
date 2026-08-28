"""Lever and Ashby both supply a posting date in their raw API response
(`createdAt` epoch millis, `publishedAt` ISO 8601) that nothing was ever
extracting into DiscoveredJob.posted_at -- the same gap fixed for
Greenhouse's `updated_at` in test_provider_greenhouse.py. Without this,
DiscoverySchedule.max_posting_age_days has no data to filter on at all.
"""

from datetime import datetime

import httpx
import pytest
from kall.providers.ashby import AshbyProvider
from kall.providers.jobs import parse_epoch_millis, parse_iso_datetime
from kall.providers.lever import LeverProvider


@pytest.mark.asyncio
async def test_lever_parses_created_at_epoch_millis_into_posted_at():
    created_at_ms = 1748000000000
    def handler(request):
        return httpx.Response(200, json=[{
            "id": "abc", "text": "Engineer", "hostedUrl": "https://x/job/1",
            "descriptionPlain": "Build things", "categories": {"location": "Remote"},
            "createdAt": created_at_ms,
        }])
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        jobs = await LeverProvider(client).collect("Acme", "acme")
    assert jobs[0].posted_at == parse_epoch_millis(created_at_ms)


@pytest.mark.asyncio
async def test_ashby_parses_published_at_into_posted_at():
    def handler(request):
        return httpx.Response(200, json={"jobs": [{
            "id": "abc", "title": "Engineer", "jobUrl": "https://x/job/1",
            "descriptionPlain": "Build things", "location": "Remote",
            "publishedAt": "2026-06-01T12:00:00.000Z",
        }]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        jobs = await AshbyProvider(client).collect("Acme", "acme")
    assert jobs[0].posted_at == datetime(2026, 6, 1, 12, 0, 0)


def test_parse_iso_datetime_rejects_malformed_input_without_raising():
    assert parse_iso_datetime("not-a-date") is None
    assert parse_iso_datetime(None) is None


def test_parse_epoch_millis_rejects_malformed_input_without_raising():
    assert parse_epoch_millis(None) is None
