"""Add job posting liveness tracking.

Revision ID: 20260904_0030
Revises: 20260831_0029
"""

import sqlalchemy as sa
from alembic import op

revision = "20260904_0030"
down_revision = "20260831_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline tables from *current* SQLModel
    # metadata (see 20260802_0014's identical guard), so a fresh database
    # already has these columns by the time this revision runs. This stays
    # a no-op there while still applying to databases that reached 0029
    # before these columns existed.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("job")}
    if "is_still_posted" not in existing_columns:
        op.add_column("job", sa.Column("is_still_posted", sa.Boolean(), nullable=False, server_default=sa.true()))
    if "liveness_checked_at" not in existing_columns:
        op.add_column("job", sa.Column("liveness_checked_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("job") as batch:
        batch.drop_column("liveness_checked_at")
        batch.drop_column("is_still_posted")
