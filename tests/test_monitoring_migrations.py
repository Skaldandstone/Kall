"""Fresh schema and preserved legacy schedule upgrade/downgrade, on local SQLite only."""

from logging.config import fileConfig

from alembic import command
from alembic.config import Config
from kall.config import get_settings
from kall.models import CareerProfile, DiscoverySchedule, User
from sqlalchemy import inspect
from sqlmodel import Session, create_engine


def test_fresh_and_existing_migration_preserves_legacy_rows(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migration.sqlite'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    config = Config("alembic.ini")
    monkeypatch.setattr("logging.config.fileConfig", lambda *args, **kwargs: fileConfig(*args, disable_existing_loggers=False, **kwargs))
    try:
        command.upgrade(config, "head")
        engine = create_engine(url)
        tables = set(inspect(engine).get_table_names())
        assert {
            "monitoringlease",
            "publicboardfeed",
            "scheduleboardstate",
            "monitoringobservation",
            "opportunitynotificationevent",
        } <= tables
        with Session(engine) as session:
            user = User(
                clerk_user_id="migration", email="migration@example.test", full_name="Migration"
            )
            session.add(user)
            session.flush()
            profile = CareerProfile(user_id=user.id, name="Legacy")
            session.add(profile)
            session.flush()
            schedule = DiscoverySchedule(
                user_id=user.id, professional_profile_id=profile.id, cadence="weekdays"
            )
            session.add(schedule)
            session.commit()
            session.refresh(schedule)
            schedule_id = schedule.id
        command.downgrade(config, "20260828_0027")
        assert "monitoringlease" not in inspect(engine).get_table_names()
        assert "monitoring_cycle_at" not in {
            c["name"] for c in inspect(engine).get_columns("discoveryschedule")
        }
        command.upgrade(config, "head")
        with Session(engine) as session:
            row = session.get(DiscoverySchedule, schedule_id)
            assert row.cadence == "weekdays" and row.enabled and row.last_success_at is None
        engine.dispose()
    finally:
        get_settings.cache_clear()
