from kall.config import Settings, build_database_url_from_parts, normalize_database_url


def test_normalizes_bare_postgres_scheme_to_psycopg_v3() -> None:
    # Managed Postgres providers hand out postgres:// URLs; SQLAlchemy 2 needs
    # an explicit driver.
    assert (
        normalize_database_url("postgres://user:pass@host/db")
        == "postgresql+psycopg://user:pass@host/db?sslmode=require"
    )


def test_normalizes_standard_postgresql_url_to_psycopg_v3() -> None:
    assert (
        normalize_database_url("postgresql://user:pass@host/db")
        == "postgresql+psycopg://user:pass@host/db?sslmode=require"
    )


def test_preserves_explicit_driver_and_sqlite_urls() -> None:
    assert normalize_database_url("postgresql+psycopg://user:pass@host/db") == (
        "postgresql+psycopg://user:pass@host/db?sslmode=require"
    )
    assert normalize_database_url("sqlite:///./kall.db") == "sqlite:///./kall.db"


def test_postgres_connections_are_encrypted_by_default() -> None:
    """A database holding EEO, work-authorization, and other sensitive fields
    must never silently fall back to a plaintext connection."""
    assert "sslmode=require" in normalize_database_url("postgres://user:pass@host/db")


def test_does_not_duplicate_an_explicit_sslmode() -> None:
    assert normalize_database_url("postgresql://user:pass@host/db?sslmode=verify-full") == (
        "postgresql+psycopg://user:pass@host/db?sslmode=verify-full"
    )


def test_custom_ssl_mode_is_honored() -> None:
    assert normalize_database_url("postgres://user:pass@host/db", ssl_mode="verify-full") == (
        "postgresql+psycopg://user:pass@host/db?sslmode=verify-full"
    )


def test_builds_database_url_from_separate_parts_and_encodes_special_characters() -> None:
    assert build_database_url_from_parts("host.example.com", 5432, "kall", "kalladmin", "p@ss/word!") == (
        "postgresql+psycopg://kalladmin:p%40ss%2Fword%21@host.example.com:5432/kall"
    )


def test_settings_prefers_db_host_parts_over_default_database_url() -> None:
    """Lets a deployment inject DB_PASSWORD from a secrets manager without any
    tooling ever needing to read the password to assemble a connection string."""
    settings = Settings(db_host="rds.example.com", db_name="kall", db_user="kalladmin", db_password="secret")
    assert settings.database_url == "postgresql+psycopg://kalladmin:secret@rds.example.com:5432/kall?sslmode=require"


def test_explicit_database_url_wins_over_db_host_parts() -> None:
    settings = Settings(database_url="postgresql://user:pass@other-host/db", db_host="rds.example.com")
    assert settings.database_url == "postgresql+psycopg://user:pass@other-host/db?sslmode=require"
