from pathlib import Path

import pytest
from kall.jobs.bootstrap_database_roles import (
    MIGRATOR_ROLE,
    RUNTIME_ROLE,
    bootstrap_database_roles,
    load_bootstrap_config,
)


def _environment(root_cert: Path) -> dict[str, str]:
    return {
        "DB_HOST": "database.example.internal",
        "DB_PORT": "5432",
        "DB_NAME": "kall",
        "DATABASE_SSL_MODE": "verify-full",
        "DATABASE_SSL_ROOT_CERT": str(root_cert),
        "MASTER_DB_USER": "kalladmin",
        "MASTER_DB_PASSWORD": "m" * 40,
        "MIGRATOR_DB_USER": MIGRATOR_ROLE,
        "MIGRATOR_DB_PASSWORD": "g" * 40,
        "RUNTIME_DB_USER": RUNTIME_ROLE,
        "RUNTIME_DB_PASSWORD": "r" * 40,
    }


class _Cursor:
    def __init__(self, fetches: list[object]) -> None:
        self.fetches = fetches
        self.calls: list[tuple[object, object]] = []

    def __enter__(self) -> "_Cursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: object, params: object = None) -> None:
        self.calls.append((query, params))

    def fetchone(self) -> object:
        return self.fetches.pop(0)


class _Connection:
    def __init__(self, cursor: _Cursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def cursor(self) -> _Cursor:
        return self._cursor


def test_bootstrap_rejects_wrong_role_names_shared_passwords_and_unverified_tls(
    tmp_path: Path,
) -> None:
    root_cert = tmp_path / "rds.pem"
    root_cert.write_text("certificate")

    for key, value in (
        ("RUNTIME_DB_USER", "someone_else"),
        ("MIGRATOR_DB_PASSWORD", "r" * 40),
        ("DATABASE_SSL_MODE", "require"),
    ):
        environ = _environment(root_cert)
        environ[key] = value
        with pytest.raises(ValueError):
            load_bootstrap_config(environ)


def test_bootstrap_uses_master_then_migrator_and_grants_runtime_only_data_access(
    tmp_path: Path,
) -> None:
    root_cert = tmp_path / "rds.pem"
    root_cert.write_text("certificate")
    config = load_bootstrap_config(_environment(root_cert))
    master_cursor = _Cursor([None, None, (0,), (0,)])
    migrator_cursor = _Cursor([])
    connections: list[dict[str, object]] = []

    def connect(**kwargs: object) -> _Connection:
        connections.append(kwargs)
        return _Connection(master_cursor if len(connections) == 1 else migrator_cursor)

    bootstrap_database_roles(config, connect=connect)

    assert [connection["user"] for connection in connections] == ["kalladmin", MIGRATOR_ROLE]
    assert all(connection["sslmode"] == "verify-full" for connection in connections)
    assert all(connection["sslrootcert"] == str(root_cert) for connection in connections)
    master_sql = "\n".join(str(query) for query, _ in master_cursor.calls)
    migrator_sql = "\n".join(str(query) for query, _ in migrator_cursor.calls)
    assert "NOSUPERUSER" in master_sql
    assert "NOCREATEDB" in master_sql
    assert "NOCREATEROLE" in master_sql
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in master_sql
    assert "GRANT USAGE, CREATE" in master_sql
    assert "ALTER DEFAULT PRIVILEGES" in migrator_sql


def test_bootstrap_refuses_unreviewed_legacy_object_ownership(tmp_path: Path) -> None:
    root_cert = tmp_path / "rds.pem"
    root_cert.write_text("certificate")
    config = load_bootstrap_config(_environment(root_cert))
    master_cursor = _Cursor([(1,), (1,), (2,)])

    with pytest.raises(RuntimeError, match="ownership must be reviewed"):
        bootstrap_database_roles(config, connect=lambda **_kwargs: _Connection(master_cursor))


def test_bootstrap_refuses_inherited_role_membership(tmp_path: Path) -> None:
    root_cert = tmp_path / "rds.pem"
    root_cert.write_text("certificate")
    config = load_bootstrap_config(_environment(root_cert))
    master_cursor = _Cursor([(1,), (1,), (0,), (1,)])

    with pytest.raises(RuntimeError, match="membership must be reviewed"):
        bootstrap_database_roles(config, connect=lambda **_kwargs: _Connection(master_cursor))
