"""Every job that wants to run hourly, in one scheduled task.

    python -m kall.jobs.hourly

The individual jobs remain runnable on their own (with --dry-run etc.);
this exists so AWS schedules one hourly task, not four. Order matters only
at the end: notifications drains the outbox last, so anything the earlier
jobs queued this tick goes out this tick instead of next.
"""

import sys

from kall.jobs import billing_grace_period, daily_brief, email_sync, notifications, run_discovery
from kall.jobs._suite import run_suite

JOBS = {
    "billing_grace_period": billing_grace_period.main,
    "daily_brief": daily_brief.main,
    "run_discovery": run_discovery.main,
    "email_sync": email_sync.main,
    "notifications": notifications.main,
}

if __name__ == "__main__":
    sys.exit(run_suite(JOBS))
