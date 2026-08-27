"""Converting a stored IANA timezone name into "what time is it for this
person right now."

Pulled out once two independent features (the daily brief's digest hour,
and opportunity discovery's run_at_local) each needed the same conversion --
the alternative was a third copy of the same six lines the next time
something needs "is it this person's preferred hour right now," which is
exactly the kind of duplication that let apply_subscription_event and
quota.py disagree about a user's plan earlier this session.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

#: Used whenever a stored timezone name no longer resolves (typo, a renamed
#: IANA zone) so one bad value degrades gracefully instead of crashing
#: whatever loop it was found in.
FALLBACK_TIMEZONE = "UTC"


def _zone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(FALLBACK_TIMEZONE)


def _as_local(timezone_name: str, now: datetime) -> datetime:
    aware = now if now.tzinfo else now.replace(tzinfo=UTC)
    return aware.astimezone(_zone(timezone_name))


def local_hour(timezone_name: str, now: datetime) -> int:
    """The hour, 0-23, it currently is in `timezone_name`.

    `now` is treated as UTC if it carries no timezone of its own -- every
    caller in this codebase passes a naive `datetime.utcnow()`-shaped value.
    """
    return _as_local(timezone_name, now).hour


def local_weekday(timezone_name: str, now: datetime) -> int:
    """0 (Monday) through 6 (Sunday), in `timezone_name` -- for a "weekdays
    only" cadence, where the day matters as much as the hour: someone whose
    local time crosses midnight relative to UTC needs the weekday checked
    the same way the hour is, not against the UTC calendar date.
    """
    return _as_local(timezone_name, now).weekday()


def next_local_occurrence(timezone_name: str, hour: int, after: datetime) -> datetime:
    """The next UTC instant at which it will be `hour`:00 in `timezone_name`,
    strictly after `after`. For display (DiscoveryTab's "Next automatic
    run") -- the actual due-to-run decision is made by re-checking the
    current local hour each time a job runs, not by trusting this value to
    the minute, so drift here is cosmetic, not a correctness risk.
    """
    zone = _zone(timezone_name)
    aware_after = after if after.tzinfo else after.replace(tzinfo=UTC)
    local_after = aware_after.astimezone(zone)
    candidate = local_after.replace(hour=hour, minute=0, second=0, microsecond=0)
    if candidate <= local_after:
        candidate += timedelta(days=1)
    return candidate.astimezone(UTC).replace(tzinfo=None)
