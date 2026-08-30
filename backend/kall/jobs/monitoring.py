"""One shared monitoring tick. Safe default is queue-only; --send requires rollout approval."""

import argparse
import asyncio
import json
import os
from threading import Event, Thread

from sqlmodel import Session

from kall.config import get_settings
from kall.db import engine
from kall.services.monitoring import continuous_schedules, run_monitoring, validate_capacity


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read capacity only; no feed requests or database writes.",
    )
    parser.add_argument(
        "--send", action="store_true", help="Allow the configured provider to send due alerts."
    )
    args = parser.parse_args(argv)
    done = Event()

    def watchdog():
        if not done.wait(120):
            # Hard process budget also covers a stalled synchronous database call.
            # Transactions roll back; durable sending rows require reconciliation.
            os._exit(124)

    Thread(target=watchdog, daemon=True).start()
    try:
        with Session(engine) as session:
            if args.dry_run:
                schedules = continuous_schedules(session)
                boards = validate_capacity(session, schedules)
                result = {
                    "status": "dry_run",
                    "enabled": get_settings().monitoring_enabled,
                    "profiles": len(schedules),
                    "boards": len(boards),
                }
            else:
                result = asyncio.run(
                    run_monitoring(session, work_seconds=110, send_notifications=args.send)
                )
        print(json.dumps(result))
        return 0
    finally:
        done.set()


if __name__ == "__main__":
    raise SystemExit(main())
