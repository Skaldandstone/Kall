import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_DATABASE_URL = "sqlite:///./kall.db"


def build_database_url_from_parts(host: str, port: int, name: str, user: str, password: str) -> str:
    """Compose a DATABASE_URL from separate fields instead of one pre-assembled string.

    Lets a deployment inject DB_PASSWORD straight from a secrets manager (e.g. ECS
    pulling an RDS-managed secret) without any tooling ever needing to read the
    password value to build a connection string containing it.
    """
    return f"postgresql+psycopg://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/{name}"


def normalize_database_url(url: str, ssl_mode: str = "require") -> str:
    """Use the installed psycopg v3 SQLAlchemy dialect for PostgreSQL URLs.

    Also enforces an encrypted connection by default. Without this, nothing
    stops the driver from silently negotiating a plaintext connection to a
    database holding EEO, work-authorization, and other sensitive fields.
    """
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql+psycopg://") and "sslmode=" not in url:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}sslmode={ssl_mode}"
    return url


class Settings(BaseSettings):
    app_env: str = "development"
    app_secret_key: str = "change-me"
    database_url: str = _DEFAULT_DATABASE_URL
    # "require" encrypts the connection without verifying the server's certificate.
    # Use "verify-full" plus database_ssl_root_cert once a CA bundle (e.g. RDS's) is available.
    database_ssl_mode: str = "require"
    database_ssl_root_cert: str | None = None
    # Alternative to DATABASE_URL: set these instead when the password should come
    # from the platform's own secret injection (e.g. an ECS `secrets` block) rather
    # than being assembled into a URL by anything that isn't the running container.
    db_host: str | None = None
    db_port: int = 5432
    db_name: str | None = None
    db_user: str | None = None
    db_password: str | None = None
    frontend_url: str = "http://localhost:3000"
    auto_create_tables: bool = True
    openai_api_key: str | None = None
    #: The small, cheap model -- every AI feature here is a short structured
    #: extraction, not a reasoning task.
    #:
    #: This was "gpt-5.1-mini" until 2026-08-26. The whole GPT-5.1 family was
    #: shut down on 2026-07-23, so that default had been returning 404 for a
    #: month with nothing to show for it: all three call sites swallowed the
    #: error and fell back, which looked exactly like "the AI is switched
    #: off". See services/openai_json.py, which now logs the reason.
    openai_model: str = "gpt-5.6-luna"
    # Private alpha access is enforced twice: the web app only exposes Clerk's
    # sign-up form for invitation tickets, and the API only creates a local
    # user when Clerk invitation metadata or this owner allowlist permits it.
    alpha_invite_only: bool = False
    alpha_allowed_emails: str = ""
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    # Sandbox integration is opt-in. Live billing is blocked in this release.
    stripe_enabled: bool = False
    stripe_livemode: bool = False
    stripe_billing_scope: str | None = None
    stripe_portal_configuration_id: str | None = None
    #: Kall Plus. Named for the plan rather than as a bare "price id" now that
    #: there is more than one.
    stripe_price_id: str | None = None
    stripe_premium_price_id: str | None = None
    stripe_plus_product_id: str | None = None
    stripe_premium_product_id: str | None = None
    sensitive_data_encryption_key: str | None = None

    #: Shared secret for the Adminhelper Worker's machine-to-machine calls to
    #: /admin/portal/* (see api_admin_portal.py) -- a separate surface from
    #: the human CS console at /admin, which is Clerk-session gated instead.
    #: Unset by default, which closes the portal router entirely.
    admin_api_token: str | None = None

    # Clerk owns identity: sign-in, sign-up, sessions, MFA, passkeys and social
    # connections. The backend only verifies the session token Clerk issues and
    # maps it to a local User row -- see kall/auth.py.
    clerk_secret_key: str | None = None
    clerk_publishable_key: str | None = None

    # Object storage for uploaded resumes and generated documents. When unset,
    # files are written to the local filesystem instead -- fine for local
    # development and tests, but not durable across a redeploy of an
    # ephemeral container (e.g. ECS Fargate).
    aws_s3_bucket: str | None = None
    aws_region: str = "us-east-2"

    #: The verified SES sender address. Notifications (opportunity digests,
    #: the morning brief, anything from services/jobs/notifications.py) are
    #: not sent at all until this is set -- see that module for why "not
    #: configured" is logged loudly rather than silently doing nothing.
    ses_sender_email: str | None = None
    # Rollout switch, separate from an individual profile's opt-in schedule.
    # The five-minute task exits without polling or sending while disabled.
    monitoring_enabled: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def alpha_allowed_email_set(self) -> set[str]:
        return {
            email.strip().casefold()
            for email in self.alpha_allowed_emails.split(",")
            if email.strip()
        }

    @model_validator(mode="after")
    def normalize_and_validate(self) -> "Settings":
        if self.database_url == _DEFAULT_DATABASE_URL and self.db_host:
            self.database_url = build_database_url_from_parts(
                self.db_host, self.db_port, self.db_name or "", self.db_user or "", self.db_password or ""
            )
        self.database_url = normalize_database_url(self.database_url, self.database_ssl_mode)
        if self.database_ssl_root_cert and "sslrootcert=" not in self.database_url:
            separator = "&" if "?" in self.database_url else "?"
            self.database_url = f"{self.database_url}{separator}sslrootcert={self.database_ssl_root_cert}"
        if self.app_env == "production":
            if self.app_secret_key == "change-me" or len(self.app_secret_key) < 32:
                raise ValueError("APP_SECRET_KEY must be at least 32 characters in production")
            if not self.sensitive_data_encryption_key or len(self.sensitive_data_encryption_key) < 32:
                raise ValueError("SENSITIVE_DATA_ENCRYPTION_KEY must be at least 32 characters in production")
            if self.sensitive_data_encryption_key == self.app_secret_key:
                raise ValueError("Production signing and sensitive-data keys must be distinct")
            if self.database_url.startswith("sqlite"):
                raise ValueError("Production must use PostgreSQL or another server database")
            if self.database_url.startswith("postgresql+psycopg://"):
                if "sslmode=verify-full" not in self.database_url:
                    raise ValueError("Production PostgreSQL must use DATABASE_SSL_MODE=verify-full")
                if not self.database_ssl_root_cert:
                    raise ValueError("DATABASE_SSL_ROOT_CERT is required for production PostgreSQL")
                certificate_bundle = Path(self.database_ssl_root_cert)
                if not certificate_bundle.is_file() or not os.access(certificate_bundle, os.R_OK):
                    raise ValueError("DATABASE_SSL_ROOT_CERT must name a readable certificate bundle")
            if not self.clerk_secret_key:
                raise ValueError(
                    "CLERK_SECRET_KEY is required in production — without it every "
                    "authenticated request fails token verification"
                )
            try:
                frontend = urlsplit(self.frontend_url)
                frontend_port = frontend.port
            except ValueError as exc:
                raise ValueError("FRONTEND_URL must be a valid HTTPS origin in production") from exc
            if (
                frontend.scheme != "https"
                or not frontend.hostname
                or frontend.username
                or frontend.password
                or frontend_port not in {None, 443}
                or frontend.path not in {"", "/"}
                or frontend.query
                or frontend.fragment
            ):
                raise ValueError("FRONTEND_URL must be a valid HTTPS origin in production")
            if self.auto_create_tables:
                raise ValueError("AUTO_CREATE_TABLES must be false in production; run Alembic separately")
            if not self.aws_s3_bucket:
                raise ValueError("AWS_S3_BUCKET is required for durable production document storage")
            if self.aws_region != "us-east-2":
                raise ValueError("AWS_REGION must match the selected Region us-east-2")
            if not self.alpha_invite_only:
                raise ValueError("Production launch remains invite-only until public sign-up is approved")
            if self.stripe_livemode:
                raise ValueError("Live Stripe billing is not approved for this release")
            if self.stripe_enabled:
                required_billing = {
                    "STRIPE_SECRET_KEY": self.stripe_secret_key,
                    "STRIPE_WEBHOOK_SECRET": self.stripe_webhook_secret,
                    "STRIPE_BILLING_SCOPE": self.stripe_billing_scope,
                    "STRIPE_PRICE_ID": self.stripe_price_id,
                    "STRIPE_PLUS_PRODUCT_ID": self.stripe_plus_product_id,
                    "STRIPE_PREMIUM_PRICE_ID": self.stripe_premium_price_id,
                    "STRIPE_PREMIUM_PRODUCT_ID": self.stripe_premium_product_id,
                    "STRIPE_PORTAL_CONFIGURATION_ID": self.stripe_portal_configuration_id,
                }
                missing = [name for name, value in required_billing.items() if not value]
                if missing:
                    raise ValueError(
                        "Stripe sandbox configuration is incomplete: " + ", ".join(missing)
                    )
                if not self.stripe_secret_key.startswith(("rk_test_", "sk_test_")):
                    raise ValueError("Production candidate accepts only Stripe sandbox keys")
                if not self.stripe_webhook_secret.startswith("whsec_"):
                    raise ValueError("STRIPE_WEBHOOK_SECRET must be a Stripe signing secret")
                if not self.stripe_billing_scope.startswith("kall:"):
                    raise ValueError("STRIPE_BILLING_SCOPE must be product-scoped to Kall")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
