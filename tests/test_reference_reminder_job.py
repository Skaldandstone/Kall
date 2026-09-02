"""Exercise the CLI against a persisted database, without any external sender."""

import logging
from datetime import datetime

from kall.jobs import reference_reminders as job
from kall.models import NotificationDelivery, Reference, User
from sqlmodel import Session, SQLModel, create_engine


def _snapshot(engine):
    with engine.connect() as connection:
        return {
            table.name: list(connection.execute(table.select()).mappings())
            for table in SQLModel.metadata.sorted_tables
        }


def test_dry_run_reports_eligibility_and_persists_no_database_changes(tmp_path, monkeypatch, caplog) -> None:
    database_url = f"sqlite:///{(tmp_path / 'reference-dry-run.db').as_posix()}"
    engine = create_engine(database_url)
    SQLModel.metadata.create_all(engine)
    now = datetime(2026, 6, 1, 12)
    with Session(engine) as session:
        user = User(clerk_user_id="user_dry_run", email="dry-run@example.com", full_name="Test User")
        session.add(user)
        session.commit()
        session.refresh(user)
        for overrides in [
            {},
            {"last_confirmed_on": now.date()},
            {"permission_to_contact": False},
            {"availability": "unavailable"},
        ]:
            fields = dict(
                user_id=user.id, name="Reference", relationship_description="Former manager",
                permission_to_contact=True, last_confirmed_on=datetime(2025, 1, 1).date(),
            )
            fields.update(overrides)
            session.add(Reference(**fields))
        session.add(NotificationDelivery(
            user_id=user.id, channel="email", kind="reference_reminder",
            dedupe_key="existing-delivery", payload={"name": "Do not change"},
        ))
        session.commit()

    before = _snapshot(engine)
    monkeypatch.setattr(job, "engine", engine)
    monkeypatch.setattr(job, "utcnow", lambda: now)
    with caplog.at_level(logging.INFO, logger=job.__name__):
        assert job.main(["--dry-run"]) == 0
    assert "Would queue 1 reminder(s)." in caplog.text
    engine.dispose()

    # A new engine/connection sees committed writes even if the CLI rolled
    # back its own session. Compare every table, including existing outbox rows.
    verification_engine = create_engine(database_url)
    try:
        assert _snapshot(verification_engine) == before
    finally:
        verification_engine.dispose()
