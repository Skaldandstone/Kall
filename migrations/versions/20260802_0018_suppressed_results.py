"""Add user-scoped suppression of dead job results.

Revision ID: 20260802_0018
Revises: 20260802_0017
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0018"
down_revision = "20260802_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline tables from *current* SQLModel
    # metadata, so a fresh database already has both of these by the time this
    # runs, while a database that reached 0017 earlier does not. Guard on
    # inspected state either way -- same approach as revisions 0014 and 0017.
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "suppressedresult" not in set(inspector.get_table_names()):
        op.create_table(
            "suppressedresult",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("url", sa.String(), nullable=False),
            sa.Column("reason", sa.String(), nullable=False, server_default="dead_link"),
            sa.Column("title", sa.String(), nullable=True),
            sa.Column("suppressed_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "url", name="uq_suppressedresult_user_url"),
        )
        op.create_index("ix_suppressedresult_user_id", "suppressedresult", ["user_id"])
        op.create_index("ix_suppressedresult_url", "suppressedresult", ["url"])

    if "jobs_skipped" not in {c["name"] for c in inspector.get_columns("searchrun")}:
        op.add_column(
            "searchrun",
            sa.Column("jobs_skipped", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    op.drop_column("searchrun", "jobs_skipped")
    op.drop_index("ix_suppressedresult_url", table_name="suppressedresult")
    op.drop_index("ix_suppressedresult_user_id", table_name="suppressedresult")
    op.drop_table("suppressedresult")
