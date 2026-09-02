from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol


@dataclass
class DiscoveredJob:
    source: str
    external_id: str | None
    company: str
    title: str
    description: str
    url: str
    location: str | None = None
    posted_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class JobBoardProvider(Protocol):
    name: str
    async def collect(self, company_name: str, board_key: str) -> list[DiscoveredJob]: ...


def parse_iso_datetime(value: str | None) -> datetime | None:
    """Parse an ATS-supplied ISO 8601 timestamp (Greenhouse's `updated_at`,
    Ashby's `publishedAt`) into a naive UTC datetime, matching the rest of
    this codebase's convention of naive `utcnow()` values.

    Returns None on anything malformed rather than raising -- one job with
    an unparsable date should not fail the whole board's import.
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def parse_epoch_millis(value: int | float | None) -> datetime | None:
    """Parse Lever's `createdAt` (milliseconds since epoch) into a naive UTC
    datetime."""
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=UTC).replace(tzinfo=None)
    except (OverflowError, OSError, ValueError):
        return None
