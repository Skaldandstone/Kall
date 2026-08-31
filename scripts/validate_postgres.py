"""Validate only an owned loopback test cluster. No existing database is changed.

Requires PostgreSQL already initialized in .venv/pg-validation/data, with its
owner-only password.txt, kall_validation role and loopback port 55437. The runner
verifies data_directory before creating uniquely named disposable databases.
It never installs, starts, stops, drops or reconfigures an existing service.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlmodel import Session, create_engine

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["APP_ENV"] = "test"
os.environ["AUTO_CREATE_TABLES"] = "false"


def main():
    owned = ROOT / ".venv/pg-validation"
    url = URL.create("postgresql+psycopg", username="kall_validation",
                     password=(owned / "password.txt").read_text().strip(),
                     host="127.0.0.1", port=55437, database="postgres",
                     query={"sslmode": "disable", "connect_timeout": "5"})
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    databases = {}
    with admin.connect() as connection:
        actual = Path(connection.execute(text("SHOW data_directory")).scalar_one()).resolve()
        if actual != (owned / "data").resolve():
            raise RuntimeError("Refusing to change a cluster outside the owned validation directory")
        version = connection.execute(text("SELECT version()")).scalar_one()
        for purpose in ("migration", "runtime"):
            name = "kall_validation_" + purpose + "_" + uuid4().hex
            # Identifiers are built only from this fixed prefix and UUID hex.
            connection.execute(text(f'CREATE DATABASE "{name}" TEMPLATE template0'))
            databases[purpose] = name
    admin.dispose()
    migration_url = url.set(database=databases["migration"])
    os.environ["DATABASE_URL"] = migration_url.render_as_string(hide_password=False)
    from kall.config import get_settings
    from kall.models import CareerProfile, DiscoverySchedule, Subscription, User

    get_settings.cache_clear()
    config = Config(str(ROOT / "alembic.ini"))
    command.upgrade(config, "head")
    migration = create_engine(migration_url)
    with Session(migration) as session:
        user = User(clerk_user_id="pg-legacy", email="pg-legacy@example.test", full_name="Legacy", plan="premium")
        session.add(user)
        session.flush()
        profile = CareerProfile(user_id=user.id, name="Legacy")
        session.add(profile)
        session.flush()
        schedule = DiscoverySchedule(user_id=user.id, professional_profile_id=profile.id, cadence="weekdays")
        subscription = Subscription(user_id=user.id, plan="premium", provider_customer_id="cus_legacy")
        session.add(schedule)
        session.add(subscription)
        session.commit()
        schedule_id, user_id = schedule.id, user.id
    command.downgrade(config, "20260828_0027")
    command.upgrade(config, "head")
    with Session(migration) as session:
        assert session.get(User, user_id).plan == "premium"
        assert session.get(DiscoverySchedule, schedule_id).cadence == "weekdays"
        from sqlmodel import select

        legacy = session.exec(select(Subscription)).one()
        assert legacy.provider_customer_id == "cus_legacy" and legacy.billing_scope is None
    migration.dispose()
    os.environ["DATABASE_URL"] = "sqlite:///./kall.db"
    get_settings.cache_clear()
    os.environ["KALL_VALIDATION_DATABASE_URL"] = url.set(database=databases["runtime"]).render_as_string(hide_password=False)
    import pytest

    result = pytest.main([str(ROOT / "validation/postgres"), "-q", "--disable-warnings", "--tb=short",
                          f"--junitxml={owned / 'results.xml'}"])
    if result == 0:
        from measure_monitoring import measure

        benchmark = asyncio.run(measure(
            engine_factory=lambda _: create_engine(url.set(database=databases["runtime"])),
            database_label="isolated local PostgreSQL 17.11",
        ))
        assert [cycle["requests"] for cycle in benchmark["cycles"]] == [10, 10, 10]
        assert [cycle["events_queued"] for cycle in benchmark["cycles"]] == [0, 0, 100]
        (owned / "benchmark.json").write_text(json.dumps(benchmark, indent=2) + "\n")
    report = {"postgresql": version, "cluster": "owned loopback-only disposable cluster",
              "existing_service_modified": False, "migration_fresh_downgrade_27_reupgrade": "passed",
              "legacy_paid_plan_customer_and_weekday_preserved": True, "runtime_pytest_exit": result,
              "databases_retained_for_inspection": databases, "stripe": "mocked", "feeds": "mocked", "sender": "disabled"}
    (owned / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return result


if __name__ == "__main__":
    raise SystemExit(main())
