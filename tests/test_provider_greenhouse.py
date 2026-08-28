from datetime import datetime

import httpx
import pytest
from kall.providers.greenhouse import GreenhouseProvider


@pytest.mark.asyncio
async def test_greenhouse_normalizes_jobs():
    def handler(request):
        return httpx.Response(200,json={"jobs":[{"id":1,"title":"Director of Engineering","absolute_url":"https://x/job/1","content":"Lead teams","location":{"name":"Remote"}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        jobs=await GreenhouseProvider(client).collect("Acme","acme")
    assert jobs[0].company=="Acme"
    assert jobs[0].title=="Director of Engineering"


@pytest.mark.asyncio
async def test_greenhouse_parses_updated_at_into_posted_at():
    """DiscoverySchedule.max_posting_age_days can only filter on a real
    posted_at -- Greenhouse's own board API supplies this as `updated_at`,
    which nothing was ever extracting."""
    def handler(request):
        return httpx.Response(200, json={"jobs": [{
            "id": 1, "title": "Engineer", "absolute_url": "https://x/job/1",
            "content": "Build things", "location": {"name": "Remote"},
            "updated_at": "2026-06-01T18:30:00-04:00",
        }]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        jobs = await GreenhouseProvider(client).collect("Acme", "acme")
    assert jobs[0].posted_at == datetime(2026, 6, 1, 22, 30, 0)
