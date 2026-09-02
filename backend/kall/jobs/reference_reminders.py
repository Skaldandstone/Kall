"""Queue a reminder for every reference that has gone stale since it was
last confirmed.

    python -m kall.jobs.reference_reminders
    python -m kall.jobs.reference_reminders --dry-run

Meant to run daily -- the staleness window is measured in months, so there
is no benefit to running this more often. It only ever queues;
jobs/notifications.py sends. Running this more than once inside the same
day queues a duplicate row, which is harmless: services/notification_delivery.py's
own dedupe check only ever lets one of them actually send.
"""

import argparse
import logging

from sqlmodel import Session

from kall.clock import utcnow
from kall.db import engine
from kall.services.reference_reminders import eligible_references, queue_reference_reminders

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report how many reminders would queue, without doing it.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(engine) as session:
        if args.dry_run:
            count = len(eligible_references(session, now=utcnow()))
            logger.info("Would queue %d reminder(s).", count)
            return 0

        count = queue_reference_reminders(session)
        logger.info("Queued %d reminder(s).", count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
