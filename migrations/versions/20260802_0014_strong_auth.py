"""Add social identity, TOTP, and passkey authentication.

Revision ID: 20260802_0014
Revises: 20260802_0013
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0014"
down_revision = "20260802_0013"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False)]


def upgrade() -> None:
    # Migration 0001 builds its baseline tables from *current* SQLModel metadata,
    # so a fresh database already has the usercredential/totp columns below by
    # the time this revision runs. Guard on inspected state so this stays a
    # no-op there while still applying to databases that reached 0013 before
    # these columns/tables existed.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("usercredential")}
    if "totp_secret_encrypted" not in existing_columns:
        op.add_column("usercredential", sa.Column("totp_secret_encrypted", sa.String(), nullable=True))
    if "totp_enabled" not in existing_columns:
        op.add_column("usercredential", sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))

    existing_tables = set(inspector.get_table_names())
    if "oauthidentity" not in existing_tables:
        op.create_table(
            "oauthidentity",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
            sa.Column("provider", sa.String(), nullable=False),
            sa.Column("provider_subject", sa.String(), nullable=False),
            sa.Column("email", sa.String()),
            *timestamps(),
            sa.UniqueConstraint("provider", "provider_subject", name="uq_oauth_provider_subject"),
        )
    if "passkeycredential" not in existing_tables:
        op.create_table(
            "passkeycredential",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("credential_id", sa.String(), nullable=False, unique=True),
            sa.Column("public_key", sa.String(), nullable=False),
            sa.Column("sign_count", sa.Integer(), nullable=False),
            sa.Column("transports", sa.String()),
            sa.Column("last_used_at", sa.DateTime()),
            *timestamps(),
        )
    if "authchallenge" not in existing_tables:
        op.create_table(
            "authchallenge",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id")),
            sa.Column("purpose", sa.String(), nullable=False),
            sa.Column("challenge", sa.String(), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("consumed_at", sa.DateTime()),
            *timestamps(),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "authchallenge" in existing_tables:
        op.drop_table("authchallenge")
    if "passkeycredential" in existing_tables:
        op.drop_table("passkeycredential")
    if "oauthidentity" in existing_tables:
        op.drop_table("oauthidentity")

    existing_columns = {column["name"] for column in inspector.get_columns("usercredential")}
    if "totp_enabled" in existing_columns:
        op.drop_column("usercredential", "totp_enabled")
    if "totp_secret_encrypted" in existing_columns:
        op.drop_column("usercredential", "totp_secret_encrypted")
