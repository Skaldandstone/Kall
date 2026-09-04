"""aggregate_job_search fans a profile's per-site queries out to Serper.dev
(a real-Google-results search API) in parallel and combines them into one
result list -- the server-side alternative to paging through
GoogleJobSearchResults' free client-side widget one site at a time.
"""

import json
from types import SimpleNamespace

import httpx
import pytest
from kall.services import job_search_aggregation


def _queries(n: int) -> list[dict]:
    return [
        {"provider": f"Provider{i}", "domain": f"site{i}.example.com", "query": f"site:site{i}.example.com role"}
        for i in range(n)
    ]


def _settings(**overrides):
    defaults = {"serper_api_key": "test-key"}
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _query_of(request: httpx.Request) -> str:
    return json.loads(request.content)["q"]


@pytest.mark.asyncio
async def test_returns_disabled_with_no_key_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(job_search_aggregation, "get_settings", lambda: _settings(serper_api_key=None))
    result = await job_search_aggregation.aggregate_job_search(_queries(3))
    assert result == {"enabled": False, "results": [], "sites_searched": 0, "sites_failed": 0}


@pytest.mark.asyncio
async def test_aggregates_and_deduplicates_results_across_sites(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(job_search_aggregation, "get_settings", lambda: _settings())

    def handler(request: httpx.Request) -> httpx.Response:
        query = _query_of(request)
        if "site0" in query:
            return httpx.Response(200, json={"organic": [
                {"title": "Role A", "link": "https://site0.example.com/a", "snippet": "..."},
                {"title": "Role B", "link": "https://site0.example.com/b", "snippet": "..."},
            ]})
        if "site1" in query:
            # Same posting indexed under both sites -- should be deduplicated.
            return httpx.Response(200, json={"organic": [
                {"title": "Role A", "link": "https://site0.example.com/a", "snippet": "..."},
            ]})
        return httpx.Response(200, json={"organic": []})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await job_search_aggregation.aggregate_job_search(_queries(2), client=client)
    await client.aclose()

    assert result["enabled"] is True
    assert result["sites_searched"] == 2
    assert result["sites_failed"] == 0
    assert len(result["results"]) == 2
    urls = {item["url"] for item in result["results"]}
    assert urls == {"https://site0.example.com/a", "https://site0.example.com/b"}


@pytest.mark.asyncio
async def test_a_failing_site_is_counted_separately_from_a_genuinely_empty_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(job_search_aggregation, "get_settings", lambda: _settings())

    def handler(request: httpx.Request) -> httpx.Response:
        query = _query_of(request)
        if "site0" in query:
            return httpx.Response(429, json={"error": "quota exceeded"})
        # A genuinely empty result set is not a failure.
        return httpx.Response(200, json={"organic": []})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await job_search_aggregation.aggregate_job_search(_queries(2), client=client)
    await client.aclose()

    assert result["sites_failed"] == 1
    assert result["sites_searched"] == 2
    assert result["results"] == []


@pytest.mark.asyncio
async def test_a_network_error_on_one_site_does_not_lose_the_others(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(job_search_aggregation, "get_settings", lambda: _settings())

    def handler(request: httpx.Request) -> httpx.Response:
        query = _query_of(request)
        if "site0" in query:
            raise httpx.ConnectTimeout("timed out", request=request)
        return httpx.Response(200, json={"organic": [
            {"title": "Role", "link": "https://site1.example.com/role", "snippet": "..."},
        ]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await job_search_aggregation.aggregate_job_search(_queries(2), client=client)
    await client.aclose()

    assert result["sites_failed"] == 1
    assert [item["url"] for item in result["results"]] == ["https://site1.example.com/role"]
