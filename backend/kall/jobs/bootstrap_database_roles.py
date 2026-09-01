"""Create and rotate the two exact PostgreSQL roles used by Kall.

This job is intentionally separate from Alembic and from the application
service. It runs once with the RDS managed-master secret, then exits. Neither
the runtime nor migration task receives the master credential.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql

MASTER_ROLE = "kalladmin"
MIGRATOR_ROLE = "kall_migrator"
RUNTIME_ROLE = "kall_runtime"
DATABASE_NAME = "kall"
BOOTSTRAP_REVISION = "kall-db-roles-v1"
BOOTSTRAP_LOCK_KEY = 1262570573
MINIMUM_PASSWORD_LENGTH = 32


@dataclass(frozen=True)
class BootstrapConfig:
    host: str
    port: int
    database: str
    root_cert: str
    master_user: str
    master_password: str
    migrator_user: str
    migrator_password: str
    runtime_user: str
    runtime_password: str


def _required(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name, "")
    if not value:
        raise ValueError(f"{name} is required")
    return value


def load_bootstrap_config(environ: Mapping[str, str] | None = None) -> BootstrapConfig:
    values = os.environ if environ is None else environ
    config = BootstrapConfig(
        host=_required(values, "DB_HOST"),
        port=int(values.get("DB_PORT", "5432")),
        database=_required(values, "DB_NAME"),
        root_cert=_required(values, "DATABASE_SSL_ROOT_CERT"),
        master_user=_required(values, "MASTER_DB_USER"),
        master_password=_required(values, "MASTER_DB_PASSWORD"),
        migrator_user=_required(values, "MIGRATOR_DB_USER"),
        migrator_password=_required(values, "MIGRATOR_DB_PASSWORD"),
        runtime_user=_required(values, "RUNTIME_DB_USER"),
        runtime_password=_required(values, "RUNTIME_DB_PASSWORD"),
    )
    if values.get("DATABASE_SSL_MODE") != "verify-full":
        raise ValueError("DATABASE_SSL_MODE must be verify-full")
    if config.database != DATABASE_NAME:
        raise ValueError(f"DB_NAME must be {DATABASE_NAME}")
    if config.master_user != MASTER_ROLE:
        raise ValueError(f"MASTER_DB_USER must be {MASTER_ROLE}")
    if config.migrator_user != MIGRATOR_ROLE:
        raise ValueError(f"MIGRATOR_DB_USER must be {MIGRATOR_ROLE}")
    if config.runtime_user != RUNTIME_ROLE:
        raise ValueError(f"RUNTIME_DB_USER must be {RUNTIME_ROLE}")
    application_passwords = (config.migrator_password, config.runtime_password)
    if any(len(password) < MINIMUM_PASSWORD_LENGTH for password in application_passwords):
        raise ValueError("migrator and runtime database passwords must be at least 32 characters")
    passwords = (config.master_password, *application_passwords)
    if len(set(passwords)) != len(passwords):
        raise ValueError("master, migrator, and runtime passwords must be distinct")
    root_cert = Path(config.root_cert)
    if not root_cert.is_file() or not os.access(root_cert, os.R_OK):
        raise ValueError("DATABASE_SSL_ROOT_CERT must name a readable certificate bundle")
    return config


def _connection_options(config: BootstrapConfig, user: str, password: str) -> dict[str, Any]:
    return {
        "host": config.host,
        "port": config.port,
        "dbname": config.database,
        "user": user,
        "password": password,
        "sslmode": "verify-full",
        "sslrootcert": config.root_cert,
        "connect_timeout": 10,
    }


def _ensure_role(cursor: Any, role: str, password: str) -> None:
    cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
    if cursor.fetchone() is None:
        cursor.execute(sql.SQL("CREATE ROLE {}").format(sql.Identifier(role)))
    cursor.execute(
        sql.SQL(
            "ALTER ROLE {} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
            "NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %s"
        ).format(sql.Identifier(role)),
        (password,),
    )


def bootstrap_database_roles(
    config: BootstrapConfig,
    connect: Callable[..., Any] = psycopg.connect,
) -> None:
    with (
        connect(
            **_connection_options(config, config.master_user, config.master_password)
        ) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", (BOOTSTRAP_LOCK_KEY,))
        _ensure_role(cursor, MIGRATOR_ROLE, config.migrator_password)
        _ensure_role(cursor, RUNTIME_ROLE, config.runtime_password)

        cursor.execute(
            sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(DATABASE_NAME))
        )
        cursor.execute(
            sql.SQL("REVOKE ALL ON DATABASE {} FROM {}").format(
                sql.Identifier(DATABASE_NAME), sql.Identifier(MIGRATOR_ROLE)
            )
        )
        cursor.execute(
            sql.SQL("REVOKE ALL ON DATABASE {} FROM {}").format(
                sql.Identifier(DATABASE_NAME), sql.Identifier(RUNTIME_ROLE)
            )
        )
        cursor.execute(
            sql.SQL("GRANT CONNECT, TEMPORARY ON DATABASE {} TO {}").format(
                sql.Identifier(DATABASE_NAME), sql.Identifier(MIGRATOR_ROLE)
            )
        )
        cursor.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(DATABASE_NAME), sql.Identifier(RUNTIME_ROLE)
            )
        )
        cursor.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        cursor.execute(
            sql.SQL("REVOKE ALL ON SCHEMA public FROM {}").format(sql.Identifier(MIGRATOR_ROLE))
        )
        cursor.execute(
            sql.SQL("REVOKE ALL ON SCHEMA public FROM {}").format(sql.Identifier(RUNTIME_ROLE))
        )
        cursor.execute(
            sql.SQL("GRANT USAGE, CREATE ON SCHEMA public TO {}").format(
                sql.Identifier(MIGRATOR_ROLE)
            )
        )
        cursor.execute(
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(RUNTIME_ROLE))
        )

        cursor.execute(
            """
                SELECT count(*)
                FROM pg_class AS item
                JOIN pg_namespace AS namespace ON namespace.oid = item.relnamespace
                JOIN pg_roles AS owner ON owner.oid = item.relowner
                WHERE namespace.nspname = 'public'
                  AND item.relkind IN ('r', 'p', 'S', 'v', 'm')
                  AND owner.rolname <> %s
                """,
            (MIGRATOR_ROLE,),
        )
        ownership_mismatches = cursor.fetchone()[0]
        if ownership_mismatches:
            raise RuntimeError(
                "public schema contains objects not owned by kall_migrator; "
                "ownership must be reviewed before migration"
            )

        cursor.execute(
            """
                SELECT count(*)
                FROM pg_auth_members AS membership
                JOIN pg_roles AS member ON member.oid = membership.member
                WHERE member.rolname IN (%s, %s)
                """,
            (MIGRATOR_ROLE, RUNTIME_ROLE),
        )
        if cursor.fetchone()[0]:
            raise RuntimeError(
                "kall_migrator or kall_runtime has inherited role membership; "
                "membership must be reviewed before migration"
            )

        cursor.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM {}").format(
                sql.Identifier(RUNTIME_ROLE)
            )
        )
        cursor.execute(
            sql.SQL(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}"
            ).format(sql.Identifier(RUNTIME_ROLE))
        )
        cursor.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM {}").format(
                sql.Identifier(RUNTIME_ROLE)
            )
        )
        cursor.execute(
            sql.SQL("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {}").format(
                sql.Identifier(RUNTIME_ROLE)
            )
        )

    with (
        connect(
            **_connection_options(config, config.migrator_user, config.migrator_password)
        ) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC")
        cursor.execute(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC"
        )
        cursor.execute(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"
        )
        cursor.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
            ).format(sql.Identifier(RUNTIME_ROLE))
        )
        cursor.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {}"
            ).format(sql.Identifier(RUNTIME_ROLE))
        )


def main() -> None:
    bootstrap_database_roles(load_bootstrap_config())
    print(f"database role bootstrap verified: {BOOTSTRAP_REVISION}")


if __name__ == "__main__":
    main()
