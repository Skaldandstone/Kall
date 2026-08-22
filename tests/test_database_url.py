from kall.config import normalize_database_url


def test_normalizes_render_postgres_url_to_psycopg_v3() -> None:
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
