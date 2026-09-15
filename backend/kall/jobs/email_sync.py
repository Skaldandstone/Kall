"""Sync every connected mailbox and propose application-status events.

    python -m kall.jobs.email_sync
    python -m kall.jobs.email_sync --dry-run

See services/email_ingest.py for the actual fetch/classify/match logic;
this is just the per-connection loop, matching run_discovery.py's shape.

Module-qualified `kall_db.engine` (not `from kall.db import engine`) so a
test's per-test database monkeypatch (tests/conftest.py) is honored --
see that file's own comment on why the `from` form silently bypasses it.
"""

import argparse
import asyncio
import logging

from sqlmodel import Session, select

from kall import db as kall_db
from kall.models import EmailConnection
from kall.services.email_ingest import MAILBOX_CLIENTS, ingest_connection

logger = logging.getLogger(__name__)


async def _sync_all(session: Session) -> dict[str, int]:
    connections = session.exec(select(EmailConnection).where(EmailConnection.status == "connected")).all()
    synced = 0
    events = 0
    errors = 0
    for connection in connections:
        client = MAILBOX_CLIENTS.get(connection.provider)
        if not client:
            continue
        try:
            created = await ingest_connection(session, connection, client)
            events += len(created)
            synced += 1
        except Exception:  # noqa: BLE001 -- one bad mailbox must not stop the rest
            logger.exception("Email sync failed for connection %s", connection.id)
            connection.status = "needs_reauth"
            connection.last_error = "Sync failed -- reconnect this mailbox"
            session.add(connection)
            session.commit()
            errors += 1
    return {"synced": synced, "events": events, "errors": errors}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report how many connections would sync, without syncing them.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with Session(kall_db.engine) as session:
        if args.dry_run:
            count = len(session.exec(select(EmailConnection).where(EmailConnection.status == "connected")).all())
            logger.info("Would sync %d connected mailbox(es).", count)
            return 0

        result = asyncio.run(_sync_all(session))
        logger.info(
            "Synced %d mailbox(es), %d event(s) proposed, %d error(s).",
            result["synced"], result["events"], result["errors"],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
