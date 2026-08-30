"""UTC delivery instants with local IANA quiet-hour and digest rules."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from kall.models import NotificationPreference


def as_local(now: datetime, timezone: str) -> datetime:
    try:
        zone = ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    return now.replace(tzinfo=UTC).astimezone(zone) if now.tzinfo is None else now.astimezone(zone)


def in_quiet_hours(preference: NotificationPreference, now: datetime) -> bool:
    start, end = preference.quiet_hours_start, preference.quiet_hours_end
    if start is None or end is None or start == end:
        return False
    local = as_local(now, preference.timezone).time()
    return start <= local < end if start < end else local >= start or local < end


def after_quiet_hours(preference: NotificationPreference, now: datetime) -> datetime:
    # Walk real UTC minutes so skipped/repeated local clock hours on DST
    # boundaries cannot manufacture a nonexistent or earlier delivery time.
    candidate = now
    while in_quiet_hours(preference, candidate):
        candidate = candidate.replace(second=0, microsecond=0) + timedelta(minutes=1)
    return candidate


def digest_ready(preference: NotificationPreference, now: datetime) -> bool:
    # A delayed job catches up later on the same local day instead of losing
    # the digest because the scheduler missed the exact preferred hour.
    return as_local(now, preference.timezone).hour >= preference.digest_hour_local


def next_digest(preference: NotificationPreference, now: datetime, *, tomorrow: bool = False) -> datetime:
    local_today = as_local(now, preference.timezone).date()
    candidate = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(60 * 50):
        local = as_local(candidate, preference.timezone)
        if local.hour >= preference.digest_hour_local and (not tomorrow or local.date() > local_today):
            return after_quiet_hours(preference, candidate)
        candidate += timedelta(minutes=1)
    raise ValueError("Unable to resolve next local digest time")
