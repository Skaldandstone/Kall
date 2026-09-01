"""Run Alembic once and fail unless the database reaches every source head."""

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from kall.config import get_settings


def migrate_and_verify(config_path: str = "alembic.ini") -> tuple[str, ...]:
    config = Config(config_path)
    command.upgrade(config, "head")

    expected_heads = tuple(sorted(ScriptDirectory.from_config(config).get_heads()))
    engine = create_engine(get_settings().database_url, poolclass=NullPool)
    try:
        with engine.connect() as connection:
            current_heads = tuple(
                sorted(MigrationContext.configure(connection).get_current_heads())
            )
    finally:
        engine.dispose()

    if current_heads != expected_heads:
        raise RuntimeError(
            f"database migration heads {current_heads!r} do not match source heads {expected_heads!r}"
        )
    return current_heads


def main() -> None:
    heads = migrate_and_verify()
    print(f"verified alembic heads: {','.join(heads)}")


if __name__ == "__main__":
    main()
