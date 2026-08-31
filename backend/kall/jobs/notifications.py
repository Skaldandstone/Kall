"""Drain the notification outbox.

    python -m kall.jobs.notifications

Sends every NotificationDelivery row that is due -- opportunity digests
today, whatever else queues into the same outbox later (the morning brief,
for instance, if it moves off its current pull-only GET /me/morning-brief
model). Nothing produces new rows here; this only sends what something else
already queued.

Runs safely with no email provider configured: rows are left queued rather
than failed, and one line is logged once so that state is visible without
watching every row individually. See services/notifications.py for why "not
configured" and "failed" are deliberately different outcomes.

Nothing schedules this yet -- same situation as jobs/retention.py. On AWS it
wants a frequent ECS scheduled task (every few minutes, since a delivery
should not sit for hours once it is actually sendable) on the existing
kall-api image.
"""

import argparse
import logging

from sqlmodel import Session

from kall.db import engine
from kall.services.notification_delivery import drain

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(engine) as session:
        counts = drain(session, limit=args.limit)

    if not counts:
        logger.info("Nothing due.")
        return 0

    logger.info("Processed: %s", ", ".join(f"{status}={n}" for status, n in sorted(counts.items())))
    if counts.get("queued"):
        logger.info(
            "%d delivery(ies) remain queued for their delivery time or provider setup. "
            "Inspect next_attempt_at and last_error; see docs/continuation/monitoring.md.",
            counts["queued"],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
