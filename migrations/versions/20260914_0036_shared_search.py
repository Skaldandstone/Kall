"""Add SharedSearch: help-a-friend public job digests.

Revision ID: 20260914_0036
Revises: 20260909_0035
"""

import sqlalchemy as sa
from alembic import op

revision = "20260914_0036"
down_revision = "20260909_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "sharedsearch" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "sharedsearch",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("friend_label", sa.String(), nullable=True),
        sa.Column("source_profile_id", sa.Integer(), sa.ForeignKey("careerprofile.id"), nullable=True),
        sa.Column("criteria", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("last_digest", sa.JSON(), nullable=True),
        sa.Column("last_refreshed_at", sa.DateTime(), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_sharedsearch_owner_user_id"), "sharedsearch", ["owner_user_id"], unique=False)
    op.create_index(op.f("ix_sharedsearch_slug"), "sharedsearch", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_table("sharedsearch")
