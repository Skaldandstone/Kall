from types import SimpleNamespace

import pytest
from kall.jobs import migrate_database


class _Engine:
    def __init__(self) -> None:
        self.disposed = False

    class _ConnectionContext:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *_args: object) -> None:
            return None

    def connect(self) -> "_Engine._ConnectionContext":
        return self._ConnectionContext()

    def dispose(self) -> None:
        self.disposed = True


def test_migration_runs_to_head_and_verifies_the_database(monkeypatch: pytest.MonkeyPatch) -> None:
    upgrades: list[tuple[object, str]] = []
    engine = _Engine()
    monkeypatch.setattr(migrate_database, "Config", lambda path: {"path": path})
    monkeypatch.setattr(
        migrate_database.command,
        "upgrade",
        lambda config, revision: upgrades.append((config, revision)),
    )
    monkeypatch.setattr(
        migrate_database.ScriptDirectory,
        "from_config",
        lambda _config: SimpleNamespace(get_heads=lambda: ["20260831_0029"]),
    )
    monkeypatch.setattr(
        migrate_database.MigrationContext,
        "configure",
        lambda _connection: SimpleNamespace(get_current_heads=lambda: ("20260831_0029",)),
    )
    monkeypatch.setattr(
        migrate_database,
        "get_settings",
        lambda: SimpleNamespace(database_url="postgresql+psycopg://database/kall"),
    )
    monkeypatch.setattr(migrate_database, "create_engine", lambda *_args, **_kwargs: engine)

    assert migrate_database.migrate_and_verify() == ("20260831_0029",)
    assert upgrades == [({"path": "alembic.ini"}, "head")]
    assert engine.disposed


def test_migration_fails_when_the_database_is_not_at_source_head(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _Engine()
    monkeypatch.setattr(migrate_database, "Config", lambda path: {"path": path})
    monkeypatch.setattr(migrate_database.command, "upgrade", lambda *_args: None)
    monkeypatch.setattr(
        migrate_database.ScriptDirectory,
        "from_config",
        lambda _config: SimpleNamespace(get_heads=lambda: ["20260831_0029"]),
    )
    monkeypatch.setattr(
        migrate_database.MigrationContext,
        "configure",
        lambda _connection: SimpleNamespace(get_current_heads=lambda: ("20260830_0028",)),
    )
    monkeypatch.setattr(
        migrate_database,
        "get_settings",
        lambda: SimpleNamespace(database_url="postgresql+psycopg://database/kall"),
    )
    monkeypatch.setattr(migrate_database, "create_engine", lambda *_args, **_kwargs: engine)

    with pytest.raises(RuntimeError, match="do not match source heads"):
        migrate_database.migrate_and_verify()
    assert engine.disposed
