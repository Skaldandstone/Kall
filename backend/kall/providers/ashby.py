import httpx
from kall.providers.jobs import DiscoveredJob, parse_iso_datetime


class AshbyProvider:
    name = "ashby"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client

    async def collect(self, company_name: str, board_key: str) -> list[DiscoveredJob]:
        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=20)
        try:
            response = await client.get(f"https://api.ashbyhq.com/posting-api/job-board/{board_key}")
            response.raise_for_status()
            return [DiscoveredJob(
                source=self.name,
                external_id=item.get("id"),
                company=company_name,
                title=item.get("title", ""),
                description=item.get("descriptionPlain") or item.get("description", ""),
                url=item.get("jobUrl", ""),
                location=item.get("location"),
                posted_at=parse_iso_datetime(item.get("publishedAt")),
                metadata={"department": item.get("department"), "team": item.get("team")},
            ) for item in response.json().get("jobs", [])]
        finally:
            if owns_client:
                await client.aclose()
