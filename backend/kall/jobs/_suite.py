"""Shared runner for the grouped scheduled jobs (hourly.py / daily.py).

Each job in a group runs even when an earlier one fails -- these jobs are
independent (a discovery bug should not stop billing enforcement), so one
bad job must cost only itself. The exit code still reports the failure so
the scheduled task shows up red.
"""

import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)


def run_suite(jobs: dict[str, Callable[[list[str] | None], int]]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    failed: list[str] = []
    for name, job_main in jobs.items():
        logger.info("=== %s ===", name)
        try:
            code = job_main([])
        except Exception:
            logger.exception("%s crashed", name)
            failed.append(name)
            continue
        if code != 0:
            logger.error("%s exited %s", name, code)
            failed.append(name)
    if failed:
        logger.error("failed jobs: %s", ", ".join(failed))
        return 1
    return 0
