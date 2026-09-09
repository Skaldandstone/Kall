"""Add owner-controlled consulting practice settings.

Revision ID: 20260909_0035
Revises: 20260908_0034
"""

import sqlalchemy as sa
from alembic import op

revision = "20260909_0035"
down_revision = "20260908_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "consultingpractice" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "consultingpractice",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("engagement_types", sa.JSON(), nullable=False),
        sa.Column("rate_cents", sa.Integer(), nullable=True),
        sa.Column("rate_basis", sa.String(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("availability_note", sa.String(), nullable=True),
        sa.Column("agreement_url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(op.f("ix_consultingpractice_user_id"), "consultingpractice", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_table("consultingpractice")
