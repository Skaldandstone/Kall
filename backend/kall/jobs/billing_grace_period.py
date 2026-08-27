"""Downgrade accounts whose payment has been failing past the 72-hour grace period.

    python -m kall.jobs.billing_grace_period
    python -m kall.jobs.billing_grace_period --dry-run

apply_payment_failed (services/billing.py) starts the clock the moment
invoice.payment_failed first arrives for a subscription; this job is what
actually enforces the deadline against that clock, since nothing else does
it on a schedule. Downgrading queues a payment_grace_period_expired
notification through the same outbox as everything else in
services/notification_delivery.py -- it sits queued, not sent, until an
email provider is configured, exactly like every other notification right
now.

Nothing schedules this yet. On AWS it wants a frequent ECS scheduled task
(hourly is plenty -- the deadline is 72 hours, not 72 minutes) on the
existing kall-api image, same as jobs/retention.py and jobs/notifications.py.
"""

import argparse
import logging

from sqlmodel import Session

from kall.db import engine
from kall.services.billing_grace_period import (
    downgrade_overdue_subscriptions,
    overdue_subscriptions,
)

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report who would be downgraded, without doing it.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(engine) as session:
        if args.dry_run:
            from datetime import datetime

            overdue = overdue_subscriptions(session, datetime.utcnow())
            logger.info("Would downgrade %d account(s): user_id %s", len(overdue), [s.user_id for s in overdue])
            return 0

        report = downgrade_overdue_subscriptions(session)
        if report.downgraded:
            logger.info("Downgraded %d account(s) to Free: user_id %s", len(report.downgraded), report.downgraded)
        else:
            logger.info("Nothing overdue.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
