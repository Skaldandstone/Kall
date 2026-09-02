"""Delete rendered document files past the retention window.

Run it:

    python -m kall.jobs.retention              # the default 365-day window
    python -m kall.jobs.retention --days 90
    python -m kall.jobs.retention --dry-run

Nothing schedules this yet. It is deliberately a standalone command rather
than a background thread in the API: it is idempotent, it takes seconds, and
running it from a scheduled task means a failure is visible in that task's
logs instead of disappearing into a web worker. On AWS the natural home is an
ECS scheduled task on the existing kall-api image, daily.

What it deletes is only ever a *rendered file*. The GeneratedDocument, its
content, its checksum and its coverage report are untouched, and asking for
the document again re-renders the identical bytes -- see
services/documents.py.
"""

import argparse
import logging

from sqlmodel import Session, select

from kall.clock import utcnow
from kall.db import engine
from kall.models import DocumentArtifact
from kall.services.documents import ARTIFACT_RETENTION_DAYS, expire_artifacts

logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=ARTIFACT_RETENTION_DAYS)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be deleted without deleting it.",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(engine) as session:
        if args.dry_run:
            from datetime import timedelta

            cutoff = utcnow() - timedelta(days=args.days)
            stale = session.exec(
                select(DocumentArtifact).where(DocumentArtifact.created_at < cutoff)
            ).all()
            total = sum(row.byte_size or 0 for row in stale)
            logger.info(
                "Would delete %d artifact(s), %.1f MB, older than %d days.",
                len(stale), total / (1024 * 1024), args.days,
            )
            return 0

        removed = expire_artifacts(session, older_than_days=args.days)
        logger.info("Deleted %d artifact(s) older than %d days.", removed, args.days)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
