"""Move identity to Clerk.

Adds User.clerk_user_id and drops the hand-rolled auth tables. Production
carried only test accounts at migration time, so no user import was needed --
everyone re-registers through Clerk.

Revision ID: 20260802_0017
Revises: 20260802_0016
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0017"
down_revision = "20260802_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline tables from *current* SQLModel
    # metadata, so a fresh database already has user.clerk_user_id by the time
    # this runs, while a database that reached 0016 earlier does not. Guard on
    # inspected state either way -- same approach as revision 0014.
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "clerk_user_id" not in {column["name"] for column in inspector.get_columns("user")}:
        op.add_column("user", sa.Column("clerk_user_id", sa.String(), nullable=True))
    if "ix_user_clerk_user_id" not in {index["name"] for index in inspector.get_indexes("user")}:
        op.create_index("ix_user_clerk_user_id", "user", ["clerk_user_id"], unique=True)

    # Order matters: these all carry a user_id FK.
    existing_tables = set(inspector.get_table_names())
    for table in ("authchallenge", "passkeycredential", "oauthidentity", "usersession", "usercredential"):
        if table in existing_tables:
            op.drop_table(table)


def downgrade() -> None:
    op.drop_index("ix_user_clerk_user_id", table_name="user")
    op.drop_column("user", "clerk_user_id")

    op.create_table(
        "usercredential",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("verification_token_hash", sa.String(), nullable=True),
        sa.Column("reset_token_hash", sa.String(), nullable=True),
        sa.Column("reset_token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("failed_login_count", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.Column("totp_secret_encrypted", sa.String(), nullable=True),
        sa.Column("totp_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "usersession",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "oauthidentity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_subject", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "passkeycredential",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("credential_id", sa.String(), nullable=False, unique=True),
        sa.Column("public_key", sa.String(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False),
        sa.Column("transports", sa.JSON(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "authchallenge",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("challenge", sa.String(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
