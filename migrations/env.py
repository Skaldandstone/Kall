from logging.config import fileConfig

import kall.models  # noqa: F401
from alembic import context
from kall.config import get_settings
from sqlalchemy import engine_from_config, pool, text
from sqlmodel import SQLModel

config = context.config
settings = get_settings()
# set_main_option() writes through configparser, which treats % as its own
# interpolation escape character. A URL-encoded password (e.g. containing %3F)
# otherwise raises "invalid interpolation syntax" here instead of connecting.
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata

# A stable, application-specific PostgreSQL advisory-lock key. Render can briefly
# start multiple service instances during a deploy; without serialization, two
# Alembic processes can both pass SQLAlchemy's existence checks and race to
# create the same table.
MIGRATION_LOCK_KEY = 1262570572


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            if connection.dialect.name == "postgresql":
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(:lock_key)"),
                    {"lock_key": MIGRATION_LOCK_KEY},
                )
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
