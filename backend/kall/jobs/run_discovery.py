"""Run every opportunity-discovery schedule that is due right now.

    python -m kall.jobs.run_discovery
    python -m kall.jobs.run_discovery --dry-run

services/scheduled_discovery.py is what this calls; see its module docstring
for what this closes: a schedule, a due-check, and the search itself all
existed with nothing ever calling them together. DiscoveryTab.tsx's own
"Next automatic run: Pending scheduler" placeholder already said as much.

Meant to run roughly hourly, matching the other jobs in this package and
matching how often a schedule's chosen hour needs to be caught. Nothing
schedules this yet either -- see docs/NEEDS_DECISION.md.
"""

import argparse
import asyncio
import logging
from datetime import datetime

from sqlmodel import Session, select

from kall.db import engine
from kall.models import DiscoverySchedule
from kall.services.opportunities import due_schedule
from kall.services.scheduled_discovery import run_due_schedules

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report which schedules would run, without running them.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(engine) as session:
        if args.dry_run:
            now = datetime.utcnow()
            due = [
                schedule.id
                for schedule in session.exec(select(DiscoverySchedule).where(DiscoverySchedule.enabled))
                if due_schedule(schedule, now)
            ]
            logger.info("Would run %d schedule(s): id %s", len(due), due)
            return 0

        result = asyncio.run(run_due_schedules(session))
        logger.info(
            "Ran %d schedule(s), %d digest(s) queued, %d error(s).",
            result["ran"], result["digests_queued"], result["errors"],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
