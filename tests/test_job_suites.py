"""The grouped scheduled jobs (kall.jobs.hourly / kall.jobs.daily).

The property that matters: one job failing -- by exception or exit code --
must not stop its siblings, and must still fail the suite. These jobs are
independent; a discovery bug must never silently pause billing enforcement.
"""

from kall.jobs import daily, hourly
from kall.jobs._suite import run_suite


def test_hourly_covers_the_four_hourly_jobs_with_notifications_last() -> None:
    names = list(hourly.JOBS)
    assert set(names) == {"billing_grace_period", "daily_brief", "run_discovery", "notifications"}
    # The outbox drain runs last so anything queued this tick sends this tick.
    assert names[-1] == "notifications"


def test_daily_covers_the_eight_daily_jobs() -> None:
    assert set(daily.JOBS) == {
        "retention",
        "job_liveness",
        "certification_reminders",
        "growth_milestone_reminders",
        "work_authorization_reminders",
        "security_clearance_reminders",
        "professional_membership_reminders",
        "reference_reminders",
    }


def test_a_crashing_job_does_not_stop_its_siblings() -> None:
    ran: list[str] = []

    def ok(argv=None) -> int:
        ran.append("ok")
        return 0

    def boom(argv=None) -> int:
        ran.append("boom")
        raise RuntimeError("job crashed")

    def also_ok(argv=None) -> int:
        ran.append("also_ok")
        return 0

    code = run_suite({"ok": ok, "boom": boom, "also_ok": also_ok})

    assert ran == ["ok", "boom", "also_ok"]
    assert code == 1


def test_a_nonzero_exit_fails_the_suite_without_stopping_it() -> None:
    ran: list[str] = []

    def bad(argv=None) -> int:
        ran.append("bad")
        return 2

    def ok(argv=None) -> int:
        ran.append("ok")
        return 0

    assert run_suite({"bad": bad, "ok": ok}) == 1
    assert ran == ["bad", "ok"]


def test_an_all_green_suite_exits_zero() -> None:
    assert run_suite({"a": lambda argv=None: 0, "b": lambda argv=None: 0}) == 0
