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


def test_production_requires_clerk_secret_key(tmp_path) -> None:
    """Identity is Clerk's, so a production service without this cannot work.

    Failing at startup is deliberate: the alternative is a container that
    boots happily and 503s every authenticated request. It is also load
    bearing for deployment -- the ECS task definitions must supply
    CLERK_SECRET_KEY, and this guard is what turns forgetting it into a
    failed deploy rather than a silently broken one.
    """
    ca_bundle = tmp_path / "ca.pem"
    ca_bundle.write_text("test certificate bundle")
    with pytest.raises(ValidationError, match="CLERK_SECRET_KEY"):
        Settings(
            app_env="production",
            app_secret_key="x" * 32,
            sensitive_data_encryption_key="y" * 32,
            database_url="postgresql+psycopg://localhost/kall",
            database_ssl_mode="verify-full",
            database_ssl_root_cert=str(ca_bundle),
        )


def test_production_requires_verified_postgres_tls(tmp_path) -> None:
    ca_bundle = tmp_path / "ca.pem"
    ca_bundle.write_text("test certificate bundle")

    with pytest.raises(ValidationError, match="verify-full"):
        Settings(
            app_env="production",
            app_secret_key="x" * 32,
            sensitive_data_encryption_key="y" * 32,
            database_url="postgresql+psycopg://localhost/kall",
            database_ssl_root_cert=str(ca_bundle),
            clerk_secret_key="sk_test_example",
        )


def test_production_requires_a_readable_postgres_ca_bundle(tmp_path) -> None:
    with pytest.raises(ValidationError, match="readable certificate bundle"):
        Settings(
            app_env="production",
            app_secret_key="x" * 32,
            sensitive_data_encryption_key="y" * 32,
            database_url="postgresql+psycopg://localhost/kall",
            database_ssl_mode="verify-full",
            database_ssl_root_cert=str(tmp_path / "missing.pem"),
            clerk_secret_key="sk_test_example",
        )


def test_production_accepts_a_complete_configuration(tmp_path) -> None:
    """The guards above must not reject a correctly configured service."""
    ca_bundle = tmp_path / "ca.pem"
    ca_bundle.write_text("test certificate bundle")
    settings = Settings(
        app_env="production",
        app_secret_key="x" * 32,
        sensitive_data_encryption_key="y" * 32,
        database_url="postgresql+psycopg://localhost/kall",
        database_ssl_mode="verify-full",
        database_ssl_root_cert=str(ca_bundle),
        clerk_secret_key="sk_test_example",
    )
    assert settings.clerk_secret_key == "sk_test_example"
