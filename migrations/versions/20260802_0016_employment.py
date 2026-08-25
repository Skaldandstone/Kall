"""Add structured employment history.

Revision ID: 20260802_0016
Revises: 20260802_0015
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0016"
down_revision = "20260802_0015"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "employment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("employer", sa.String(), nullable=False),
        sa.Column("job_title", sa.String(), nullable=False),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_employment_user_id", "employment", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_employment_user_id", table_name="employment")
    op.drop_table("employment")
