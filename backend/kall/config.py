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
    #: Unset by design (see services/job_search_aggregation.py) rather than
    #: required: the hidden-market search's per-site Google Programmable
    #: Search widget already works without it, so this is a genuine upgrade,
    #: not a hard dependency.
    #:
    #: Google's own Custom Search JSON API is closed to new customers (and
    #: being retired entirely on 2027-01-01), so this aggregation is backed
    #: by Serper.dev, which wraps real Google results behind a plain API key
    #: -- no separate search-engine ID to manage.
    serper_api_key: str | None = None
    # Private alpha access is enforced twice: the web app only exposes Clerk's
    # sign-up form for invitation tickets, and the API only creates a local
    # user when Clerk invitation metadata or this owner allowlist permits it.
    alpha_invite_only: bool = False
    alpha_allowed_emails: str = ""
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    # Billing is opt-in. Stripe test and live objects are separate, and every
    # provider object is checked against this explicit environment before it
    # can change an entitlement.
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
    # RevenueCat bridges native StoreKit and Google Play purchases. The SDK keys
    # are public and live only in the mobile build; the API receives only signed
    # webhook events and keeps the final entitlement decision server-side.
    revenuecat_enabled: bool = False
    revenuecat_webhook_authorization: str | None = None
    revenuecat_webhook_signing_secret: str | None = None
    revenuecat_accepted_environments: str = "PRODUCTION"
    revenuecat_google_plus_product_id: str | None = None
    revenuecat_google_premium_product_id: str | None = None
    revenuecat_apple_plus_product_id: str | None = None
    revenuecat_apple_premium_product_id: str | None = None
    #: RevenueCat secret (server) API key. Only the staff portal's Google Play
    #: refund path uses it; unset means that action reports not configured.
    revenuecat_secret_api_key: str | None = None
    sensitive_data_encryption_key: str | None = None

    # Email connection (Gmail/Outlook, read-only) for auto-detecting
    # application status from confirmation/interview/rejection mail -- see
    # services/email_oauth.py. Narrowest possible scope requested from each
    # provider's own consent screen (gmail.readonly / Mail.Read), never a
    # send/modify scope. Unset means that provider's connect button reports
    # not configured, matching every other optional integration here.
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: str | None = None
    microsoft_oauth_client_id: str | None = None
    microsoft_oauth_client_secret: str | None = None
    #: Where a provider's consent screen redirects back to after the person
    #: approves access -- must exactly match what's registered with that
    #: provider. Defaults to the same public API origin every other webhook
    #: and OAuth-style callback in this app already uses.
    email_oauth_redirect_base_url: str | None = None

    #: Shared secret for the Adminhelper Worker's machine-to-machine calls to
    #: /admin/portal/* (see api_admin_portal.py) -- a separate surface from
    #: the human CS console at /admin, which is Clerk-session gated instead.
    #: Unset by default, which closes the portal router entirely.
    admin_api_token: str | None = None
    #: Hard ceiling, in cents, for a single portal-issued Stripe refund. A
    #: larger refund is refused outright rather than partially issued.
    refund_cap_cents: int = 20000

    # Clerk owns identity: sign-in, sign-up, sessions, MFA, passkeys and social
    # connections. The backend only verifies the session token Clerk issues and
    # maps it to a local User row -- see kall/auth.py.
    clerk_secret_key: str | None = None
    clerk_publishable_key: str | None = None
    clerk_authorized_parties: str = ""

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

    #: Sentry error tracking (see kall/observability.py). Unset means off,
    #: which is the state for local development and tests. A DSN is public by
    #: design - it can only send events to one project - so in production it
    #: is a plaintext task-definition variable, not a Secrets Manager entry.
    sentry_dsn: str | None = None
    #: Defaults to app_env. Set explicitly when one deployment should report
    #: under a different name (e.g. a bounded alpha session).
    sentry_environment: str | None = None
    #: Errors only by default. Tracing attaches per-request timing and URLs.
    sentry_traces_sample_rate: float = 0.0
    #: Reported as the Sentry release so an issue names the code it came from.
    app_version: str = "0.9.0"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def alpha_allowed_email_set(self) -> set[str]:
        return {
            email.strip().casefold()
            for email in self.alpha_allowed_emails.split(",")
            if email.strip()
        }

    @property
    def clerk_authorized_party_list(self) -> list[str]:
        return [party.strip().rstrip("/") for party in self.clerk_authorized_parties.split(",") if party.strip()]

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
            if not self.clerk_secret_key.startswith("sk_live_"):
                raise ValueError("Production requires a Clerk production secret key")
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
            frontend_origin = f"{frontend.scheme}://{frontend.hostname}"
            if frontend_port:
                frontend_origin += f":{frontend_port}"
            if frontend_origin not in self.clerk_authorized_party_list:
                raise ValueError("CLERK_AUTHORIZED_PARTIES must include the production frontend origin")
            if self.auto_create_tables:
                raise ValueError("AUTO_CREATE_TABLES must be false in production; run Alembic separately")
            if not self.aws_s3_bucket:
                raise ValueError("AWS_S3_BUCKET is required for durable production document storage")
            if self.aws_region != "us-east-2":
                raise ValueError("AWS_REGION must match the selected Region us-east-2")
            # Public sign-up is now a supported production state, but it has to be
            # chosen. The field default is permissive so local development is not
            # gated, which means an unset variable in production would silently open
            # registration -- the one failure mode the old blanket rejection did
            # prevent. Requiring it explicitly keeps production failing closed.
            if "alpha_invite_only" not in self.model_fields_set:
                raise ValueError(
                    "ALPHA_INVITE_ONLY must be set explicitly in production; "
                    "omitting it would open registration by default"
                )
            if not self.alpha_invite_only and not self.alpha_allowed_email_set:
                # The allowlist is what makes closing registration again a config
                # flip rather than a redeploy. Losing it strands the rollback path.
                raise ValueError(
                    "ALPHA_ALLOWED_EMAILS must stay populated when public sign-up is enabled, "
                    "so invite-only can be restored without a code change"
                )
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
                        "Stripe configuration is incomplete: " + ", ".join(missing)
                    )
                expected_prefixes = ("rk_live_", "sk_live_") if self.stripe_livemode else ("rk_test_", "sk_test_")
                if not self.stripe_secret_key.startswith(expected_prefixes):
                    raise ValueError("Stripe key environment does not match STRIPE_LIVEMODE")
                if not self.stripe_webhook_secret.startswith("whsec_"):
                    raise ValueError("STRIPE_WEBHOOK_SECRET must be a Stripe signing secret")
                if not self.stripe_billing_scope.startswith("kall:"):
                    raise ValueError("STRIPE_BILLING_SCOPE must be product-scoped to Kall")
                if self.stripe_livemode and self.stripe_billing_scope != "kall:production":
                    raise ValueError("Live Stripe billing must use STRIPE_BILLING_SCOPE=kall:production")
                if not self.stripe_livemode and self.stripe_billing_scope == "kall:production":
                    raise ValueError("Stripe sandbox billing must not use the production billing scope")
            if self.revenuecat_enabled:
                native_required = {
                    "REVENUECAT_WEBHOOK_AUTHORIZATION": self.revenuecat_webhook_authorization,
                    "REVENUECAT_WEBHOOK_SIGNING_SECRET": self.revenuecat_webhook_signing_secret,
                    "REVENUECAT_GOOGLE_PLUS_PRODUCT_ID": self.revenuecat_google_plus_product_id,
                    "REVENUECAT_GOOGLE_PREMIUM_PRODUCT_ID": self.revenuecat_google_premium_product_id,
                }
                missing = [name for name, value in native_required.items() if not value]
                if missing:
                    raise ValueError("RevenueCat configuration is incomplete: " + ", ".join(missing))
                apple_products = (
                    self.revenuecat_apple_plus_product_id,
                    self.revenuecat_apple_premium_product_id,
                )
                if bool(apple_products[0]) != bool(apple_products[1]):
                    raise ValueError("RevenueCat Apple product identifiers must be configured together")
                environments = {
                    value.strip().upper()
                    for value in self.revenuecat_accepted_environments.split(",")
                    if value.strip()
                }
                if not environments or not environments <= {"PRODUCTION", "SANDBOX"}:
                    raise ValueError(
                        "REVENUECAT_ACCEPTED_ENVIRONMENTS must contain only PRODUCTION and SANDBOX"
                    )
                product_ids = [
                    self.revenuecat_google_plus_product_id,
                    self.revenuecat_google_premium_product_id,
                    self.revenuecat_apple_plus_product_id,
                    self.revenuecat_apple_premium_product_id,
                ]
                configured_product_ids = [value for value in product_ids if value]
                if len(set(configured_product_ids)) != len(configured_product_ids):
                    raise ValueError("RevenueCat product identifiers must be unique")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
