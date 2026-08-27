"""Add SearchRun.ats_search_query, so run history shows what was actually
searched for at the time, even after the profile's own criteria change.

Revision ID: 20260827_0025
Revises: 20260827_0024
"""

import sqlalchemy as sa
from alembic import op

revision = "20260827_0025"
down_revision = "20260827_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("searchrun")}
    if "ats_search_query" in columns:
        return

    op.add_column("searchrun", sa.Column("ats_search_query", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("searchrun", "ats_search_query")
