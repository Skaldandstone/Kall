"""Add account deletion: nothing removed accounts before this.

Revision ID: 20260827_0023
Revises: 20260827_0022
"""

import sqlalchemy as sa
from alembic import op

revision = "20260827_0023"
down_revision = "20260827_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline from current SQLModel metadata, so a
    # fresh database already has this -- same guard as revisions 0017 to 0021.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "accountdeletionrecord" in set(inspector.get_table_names()):
        return

    op.create_table(
        "accountdeletionrecord",
        sa.Column("id", sa.Integer(), nullable=False),
        # Not a foreign key -- the point is to survive the account it
        # describes being gone. See the model docstring.
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("clerk_user_id", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_accountdeletionrecord_email"), "accountdeletionrecord", ["email"]
    )
    op.create_index(
        op.f("ix_accountdeletionrecord_clerk_user_id"), "accountdeletionrecord", ["clerk_user_id"]
    )
    op.create_index(
        op.f("ix_accountdeletionrecord_deleted_at"), "accountdeletionrecord", ["deleted_at"]
    )


def downgrade() -> None:
    op.drop_table("accountdeletionrecord")
