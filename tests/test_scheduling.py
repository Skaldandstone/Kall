"""local_hour/next_local_occurrence: the timezone conversion two separate
features (the daily brief's digest hour, discovery's run_at_local) each
needed, pulled into one place rather than a third copy of the same code.
"""

from datetime import datetime

from kall.services.scheduling import local_hour, next_local_occurrence


def test_local_hour_converts_from_utc() -> None:
    # 15:00 UTC in August is 08:00 in America/Los_Angeles (UTC-7, DST).
    assert local_hour("America/Los_Angeles", datetime(2026, 8, 27, 15, 0)) == 8


def test_local_hour_treats_a_naive_datetime_as_utc() -> None:
    assert local_hour("UTC", datetime(2026, 8, 27, 9, 0)) == 9


def test_an_unresolvable_timezone_falls_back_to_utc() -> None:
    assert local_hour("Not/A_Real_Zone", datetime(2026, 8, 27, 9, 0)) == 9


def test_next_occurrence_is_later_today_if_the_hour_has_not_passed() -> None:
    after = datetime(2026, 8, 27, 5, 0)  # 05:00 UTC
    result = next_local_occurrence("UTC", 8, after)
    assert result == datetime(2026, 8, 27, 8, 0)


def test_next_occurrence_rolls_to_tomorrow_if_the_hour_already_passed() -> None:
    after = datetime(2026, 8, 27, 9, 0)  # past 08:00 UTC already
    result = next_local_occurrence("UTC", 8, after)
    assert result == datetime(2026, 8, 28, 8, 0)


def test_next_occurrence_respects_a_real_timezone_offset() -> None:
    # 8am in America/Los_Angeles in August (UTC-7) is 15:00 UTC.
    after = datetime(2026, 8, 27, 5, 0)
    result = next_local_occurrence("America/Los_Angeles", 8, after)
    assert result == datetime(2026, 8, 27, 15, 0)
