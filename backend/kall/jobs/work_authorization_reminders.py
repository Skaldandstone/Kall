"""Queue a reminder for every work authorization that just entered its
reminder window.

    python -m kall.jobs.work_authorization_reminders
    python -m kall.jobs.work_authorization_reminders --dry-run

Meant to run daily -- the window is measured in days, not hours, so there
is no benefit to running this more often. It only ever queues;
jobs/notifications.py sends. Running this more than once inside the same
day queues a duplicate row, which is harmless: services/notification_delivery.py's
own dedupe check only ever lets one of them actually send.

Nothing schedules this yet, same situation as the other jobs in this
package. On AWS it wants a daily ECS scheduled task on the existing
kall-api image.
"""

import argparse
import logging

from sqlmodel import Session

from kall.clock import utcnow
from kall.db import engine
from kall.services.work_authorization_reminders import queue_work_authorization_reminders

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report how many reminders would queue, without doing it.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(engine) as session:
        if args.dry_run:
            count = queue_work_authorization_reminders(session, now=utcnow())
            session.rollback()
            logger.info("Would queue %d reminder(s).", count)
            return 0

        count = queue_work_authorization_reminders(session)
        logger.info("Queued %d reminder(s).", count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
