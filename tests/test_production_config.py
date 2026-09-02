import pytest
from kall.config import Settings
from pydantic import ValidationError


def complete_production_config(tmp_path) -> dict[str, object]:
    ca_bundle = tmp_path / "ca.pem"
    ca_bundle.write_text("test certificate bundle")
    return {
        "app_env": "production",
        "app_secret_key": "x" * 32,
        "sensitive_data_encryption_key": "y" * 32,
        "database_url": "postgresql+psycopg://localhost/kall",
        "database_ssl_mode": "verify-full",
        "database_ssl_root_cert": str(ca_bundle),
        "clerk_secret_key": "sk_live_example",
        "clerk_authorized_parties": "https://kall.example.com",
        "frontend_url": "https://kall.example.com",
        "auto_create_tables": False,
        "aws_s3_bucket": "kall-production-documents",
        "aws_region": "us-east-2",
        "alpha_invite_only": True,
    }


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
            clerk_secret_key="sk_live_example",
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
            clerk_secret_key="sk_live_example",
        )


def test_production_accepts_a_complete_configuration(tmp_path) -> None:
    """The guards above must not reject a correctly configured service."""
    settings = Settings(**complete_production_config(tmp_path))
    assert settings.clerk_secret_key == "sk_live_example"


@pytest.mark.parametrize(
    ("setting", "value", "message"),
    [
        ("frontend_url", "http://kall.example.com", "HTTPS origin"),
        ("frontend_url", "https://kall.example.com:99999", "HTTPS origin"),
        ("auto_create_tables", True, "Alembic"),
        ("aws_s3_bucket", None, "AWS_S3_BUCKET"),
        ("aws_region", "us-east-1", "selected Region"),
        ("alpha_invite_only", False, "ALPHA_ALLOWED_EMAILS"),
        ("sensitive_data_encryption_key", "short", "at least 32"),
        ("sensitive_data_encryption_key", "x" * 32, "must be distinct"),
    ],
)
def test_production_rejects_unsafe_release_configuration(
    tmp_path, setting: str, value: object, message: str
) -> None:
    config = complete_production_config(tmp_path)
    config[setting] = value
    with pytest.raises(ValidationError, match=message):
        Settings(**config)


def test_production_requires_an_explicit_access_decision(tmp_path) -> None:
    """Omitting the flag must fail rather than inherit the permissive default.

    The field defaults to False so local development is not gated behind
    invitations. That default is wrong for production, so production refuses to
    infer it -- registration opens only when someone says so.
    """
    config = complete_production_config(tmp_path)
    del config["alpha_invite_only"]
    with pytest.raises(ValidationError, match="ALPHA_INVITE_ONLY must be set explicitly"):
        Settings(**config)


def test_production_allows_public_signup_when_allowlist_is_retained(tmp_path) -> None:
    """Public sign-up is a supported production state, not a rejected one.

    The allowlist stays populated so restoring invite-only is a parameter flip
    rather than a redeploy -- that is the whole reason the guard survives.
    """
    config = complete_production_config(tmp_path)
    config["alpha_invite_only"] = False
    config["alpha_allowed_emails"] = "james@skaldandstone.com"
    settings = Settings(**config)
    assert settings.alpha_invite_only is False
    assert settings.alpha_allowed_email_set == {"james@skaldandstone.com"}


def test_production_rejects_public_signup_that_drops_the_rollback_allowlist(tmp_path) -> None:
    config = complete_production_config(tmp_path)
    config["alpha_invite_only"] = False
    config["alpha_allowed_emails"] = ""
    with pytest.raises(ValidationError, match="ALPHA_ALLOWED_EMAILS"):
        Settings(**config)


def test_production_requires_complete_product_scoped_stripe_sandbox(tmp_path) -> None:
    config = complete_production_config(tmp_path)
    config.update(stripe_enabled=True, stripe_secret_key="rk_test_example")
    with pytest.raises(ValidationError, match="STRIPE_WEBHOOK_SECRET"):
        Settings(**config)

    config.update(
        stripe_webhook_secret="whsec_example",
        stripe_billing_scope="other:test",
        stripe_price_id="price_plus",
        stripe_plus_product_id="prod_plus",
        stripe_premium_price_id="price_premium",
        stripe_premium_product_id="prod_premium",
        stripe_portal_configuration_id="bpc_kall",
    )
    with pytest.raises(ValidationError, match="product-scoped to Kall"):
        Settings(**config)

    config["stripe_billing_scope"] = "kall:test:production-candidate"
    settings = Settings(**config)
    assert settings.stripe_enabled is True
    assert settings.stripe_livemode is False


def test_production_accepts_only_matching_live_stripe_configuration(tmp_path) -> None:
    config = complete_production_config(tmp_path)
    config.update(
        stripe_enabled=True,
        stripe_livemode=True,
        stripe_secret_key="rk_live_example",
        stripe_webhook_secret="whsec_example",
        stripe_billing_scope="kall:production",
        stripe_price_id="price_plus_live",
        stripe_plus_product_id="prod_plus_live",
        stripe_premium_price_id="price_premium_live",
        stripe_premium_product_id="prod_premium_live",
        stripe_portal_configuration_id="bpc_kall_live",
    )
    assert Settings(**config).stripe_livemode is True

    config["stripe_secret_key"] = "rk_test_wrong_environment"
    with pytest.raises(ValidationError, match="environment does not match"):
        Settings(**config)

    config["stripe_secret_key"] = "rk_live_example"
    config["stripe_billing_scope"] = "kall:test"
    with pytest.raises(ValidationError, match="kall:production"):
        Settings(**config)


def test_production_rejects_development_clerk_or_missing_authorized_origin(tmp_path) -> None:
    config = complete_production_config(tmp_path)
    config["clerk_secret_key"] = "sk_test_wrong_environment"
    with pytest.raises(ValidationError, match="Clerk production secret"):
        Settings(**config)

    config["clerk_secret_key"] = "sk_live_example"
    config["clerk_authorized_parties"] = "https://other.example.com"
    with pytest.raises(ValidationError, match="production frontend origin"):
        Settings(**config)
