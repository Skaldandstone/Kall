"""The one place the application asks what time it is.

Every stored timestamp in Kall is naive UTC: the columns were created that
way and roughly sixty models compare against them, so making them aware
would be a migration, not a refactor. What this module removes is the
*deprecated* way of producing that value. `datetime.utcnow()` is scheduled
for removal from Python, and its real problem is that it returns a naive
datetime that silently claims to be local time.

`utcnow()` here is deliberately identical in result to the old call -- the
UTC wall clock, without a tzinfo -- so call sites and stored data are
unchanged. The conversion to an aware value happens once, explicitly, and
`.replace(tzinfo=None)` drops it again at the boundary, which is the idiom
already used elsewhere in the backend.

Prefer this over `datetime.now(UTC)` for anything that lands in a column;
use an aware datetime only where the value leaves the system (an API
response, a signed token, an ISO string a client will parse).
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    """Current UTC time as a naive datetime, matching how Kall stores time."""
    return datetime.now(UTC).replace(tzinfo=None)


def utcfromtimestamp(timestamp: float) -> datetime:
    """A POSIX timestamp as naive UTC, matching :func:`utcnow`."""
    return datetime.fromtimestamp(timestamp, UTC).replace(tzinfo=None)
