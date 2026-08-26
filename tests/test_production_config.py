import pytest
from kall.config import Settings
from pydantic import ValidationError


def test_production_rejects_default_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="production", database_url="postgresql+psycopg://localhost/kall")


def test_production_requires_server_database() -> None:
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            app_secret_key="x" * 32,
            sensitive_data_encryption_key="y" * 32,
            database_url="sqlite:///./kall.db",
        )


def test_production_requires_clerk_secret_key() -> None:
    """Identity is Clerk's, so a production service without this cannot work.

    Failing at startup is deliberate: the alternative is a container that
    boots happily and 503s every authenticated request. It is also load
    bearing for deployment -- the ECS task definitions must supply
    CLERK_SECRET_KEY, and this guard is what turns forgetting it into a
    failed deploy rather than a silently broken one.
    """
    with pytest.raises(ValidationError, match="CLERK_SECRET_KEY"):
        Settings(
            app_env="production",
            app_secret_key="x" * 32,
            sensitive_data_encryption_key="y" * 32,
            database_url="postgresql+psycopg://localhost/kall",
        )


def test_production_accepts_a_complete_configuration() -> None:
    """The guards above must not reject a correctly configured service."""
    settings = Settings(
        app_env="production",
        app_secret_key="x" * 32,
        sensitive_data_encryption_key="y" * 32,
        database_url="postgresql+psycopg://localhost/kall",
        clerk_secret_key="sk_test_example",
    )
    assert settings.clerk_secret_key == "sk_test_example"
