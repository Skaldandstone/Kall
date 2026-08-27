"""Queue the emailed daily brief for everyone whose local hour matches.

    python -m kall.jobs.daily_brief
    python -m kall.jobs.daily_brief --dry-run

Meant to run roughly hourly. It only ever queues -- the actual sending is
jobs/notifications.py's job, same outbox as everything else. Running this
more than once inside someone's matching hour queues a duplicate row, which
is harmless: services/notification_delivery.py's own dedupe check only ever
lets one of them actually send.

Nothing schedules this yet, same situation as the other three jobs in this
package. On AWS it wants an hourly ECS scheduled task on the existing
kall-api image.
"""

import argparse
import logging
from datetime import datetime

from sqlmodel import Session

from kall.db import engine
from kall.services.notification_delivery import queue_daily_briefs

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report who would be queued, without doing it.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(engine) as session:
        if args.dry_run:
            # queue_daily_briefs always writes; a dry run counts the same
            # way and rolls the transaction back rather than committing.
            count = queue_daily_briefs(session, now=datetime.utcnow())
            session.rollback()
            logger.info("Would queue %d brief(s).", count)
            return 0

        count = queue_daily_briefs(session)
        logger.info("Queued %d brief(s).", count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
