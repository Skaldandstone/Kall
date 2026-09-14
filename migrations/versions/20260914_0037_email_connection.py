"""Add EmailConnection: read-only mailbox connections for application-status detection.

Revision ID: 20260914_0037
Revises: 20260914_0036
"""

import sqlalchemy as sa
from alembic import op

revision = "20260914_0037"
down_revision = "20260914_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "emailconnection" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "emailconnection",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("access_token_encrypted", sa.String(), nullable=False),
        sa.Column("refresh_token_encrypted", sa.String(), nullable=True),
        sa.Column("scope", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("sync_cursor", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_emailconnection_user_id"), "emailconnection", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_table("emailconnection")
