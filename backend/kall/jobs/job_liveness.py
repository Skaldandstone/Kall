"""Re-check every tracked application's job posting, once a day.

    python -m kall.jobs.job_liveness

Keeps the /applications pipeline accurate: a posting that gets taken down
after someone applies should show that, instead of silently going stale.
See services/job_liveness.py for the actual check.
"""

import logging

from sqlmodel import Session

from kall.db import engine
from kall.services.job_liveness import recheck_tracked_job_postings

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    del argv
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    with Session(engine) as session:
        result = recheck_tracked_job_postings(session)
    logger.info("Checked %d posting(s), %d newly flagged as no longer posted.", result["checked"], result["newly_flagged"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
