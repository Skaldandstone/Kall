"""Additive billing upgrade preserves legacy identities without trusting them."""

from logging.config import fileConfig

from alembic import command
from alembic.config import Config
from kall.config import get_settings
from kall.models import User
from sqlalchemy import inspect, text
from sqlmodel import create_engine


def test_legacy_billing_rows_survive_upgrade_and_downgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'billing-migration.sqlite'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    monkeypatch.setattr("logging.config.fileConfig", lambda *args, **kwargs: fileConfig(*args, disable_existing_loggers=False, **kwargs))
    config = Config("alembic.ini")
    engine = create_engine(url)
    try:
        command.upgrade(config, "20260830_0028")
        with engine.begin() as connection:
            connection.execute(User.__table__.insert().values(id=1, clerk_user_id="legacy", email="legacy@example.test", full_name="Legacy", plan="premium"))
            connection.execute(text("INSERT INTO subscription (id, user_id, provider, provider_customer_id, provider_subscription_id, status, plan, cancel_at_period_end, created_at, updated_at) VALUES (1, 1, 'stripe', 'cus_legacy', 'sub_legacy', 'active', 'premium', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        for _ in range(2):
            command.upgrade(config, "head")
            with engine.connect() as connection:
                row = connection.execute(text("SELECT plan, provider_customer_id, billing_scope, provider_livemode, billing_binding_key FROM subscription WHERE id=1")).one()
                assert tuple(row) == ("premium", "cus_legacy", None, None, None)
                assert connection.execute(text("SELECT plan FROM user WHERE id=1")).scalar_one() == "PREMIUM"
            constraints = {item["name"] for item in inspect(engine).get_unique_constraints("subscription")}
            assert {"uq_subscription_scope_customer", "uq_subscription_scope_subscription"} <= constraints
            command.downgrade(config, "20260830_0028")
            assert "billing_scope" not in {col["name"] for col in inspect(engine).get_columns("subscription")}
    finally:
        engine.dispose()
        get_settings.cache_clear()
