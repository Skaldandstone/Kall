import httpx
from kall.providers.jobs import DiscoveredJob, parse_epoch_millis


class LeverProvider:
    name = "lever"

    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client

    async def collect(self, company_name: str, board_key: str) -> list[DiscoveredJob]:
        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=20)
        try:
            response = await client.get(f"https://api.lever.co/v0/postings/{board_key}", params={"mode":"json"})
            response.raise_for_status()
            return self.parse(response.json(), company_name)
        finally:
            if owns_client:
                await client.aclose()

    def parse(self, payload, company_name: str) -> list[DiscoveredJob]:
        return [DiscoveredJob(
            source=self.name,
            external_id=item.get("id"),
            company=company_name,
            title=item.get("text", ""),
            description=item.get("descriptionPlain") or item.get("description", ""),
            url=item.get("hostedUrl", ""),
            location=(item.get("categories") or {}).get("location"),
            posted_at=parse_epoch_millis(item.get("createdAt")),
            metadata={"team": (item.get("categories") or {}).get("team")},
        ) for item in payload]
