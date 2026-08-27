from functools import lru_cache
from urllib.parse import quote

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
    openai_model: str = "gpt-5.1-mini"
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    #: Kall Plus. Named for the plan rather than as a bare "price id" now that
    #: there is more than one.
    stripe_price_id: str | None = None
    stripe_premium_price_id: str | None = None
    sensitive_data_encryption_key: str | None = None

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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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
            if not self.sensitive_data_encryption_key:
                raise ValueError("SENSITIVE_DATA_ENCRYPTION_KEY is required in production")
            if self.database_url.startswith("sqlite"):
                raise ValueError("Production must use PostgreSQL or another server database")
            if not self.clerk_secret_key:
                raise ValueError(
                    "CLERK_SECRET_KEY is required in production — without it every "
                    "authenticated request fails token verification"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
