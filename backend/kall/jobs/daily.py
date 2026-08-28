"""Every job that wants to run daily, in one scheduled task.

    python -m kall.jobs.daily

Same shape as hourly.py: the individual jobs stay runnable on their own,
AWS schedules one daily task.
"""

import sys

from kall.jobs import (
    certification_reminders,
    growth_milestone_reminders,
    retention,
    security_clearance_reminders,
    work_authorization_reminders,
)
from kall.jobs._suite import run_suite

JOBS = {
    "retention": retention.main,
    "certification_reminders": certification_reminders.main,
    "growth_milestone_reminders": growth_milestone_reminders.main,
    "work_authorization_reminders": work_authorization_reminders.main,
    "security_clearance_reminders": security_clearance_reminders.main,
}

if __name__ == "__main__":
    sys.exit(run_suite(JOBS))
