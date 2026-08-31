import html

import httpx
from kall.providers.jobs import DiscoveredJob, parse_iso_datetime


class GreenhouseProvider:
    name = "greenhouse"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client

    async def collect(self, company_name: str, board_key: str) -> list[DiscoveredJob]:
        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=20)
        try:
            response = await client.get(
                f"https://boards-api.greenhouse.io/v1/boards/{board_key}/jobs",
                params={"content": "true"},
            )
            response.raise_for_status()
            return self.parse(response.json(), company_name)
        finally:
            if owns_client:
                await client.aclose()

    def parse(self, payload, company_name: str) -> list[DiscoveredJob]:
        rows=[]
        for item in payload.get("jobs", []):
            rows.append(DiscoveredJob(
                source=self.name,
                external_id=str(item.get("id")) if item.get("id") is not None else None,
                company=company_name,
                title=item.get("title", ""),
                description=html.unescape(item.get("content", "")),
                url=item.get("absolute_url", ""),
                location=(item.get("location") or {}).get("name"),
                posted_at=parse_iso_datetime(item.get("updated_at")),
                metadata={"departments": item.get("departments", []), "offices": item.get("offices", [])},
            ))
        return rows
