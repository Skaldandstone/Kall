"""Add the administrative audit log.

Revision ID: 20260802_0021
Revises: 20260802_0020
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0021"
down_revision = "20260802_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline from current SQLModel metadata, so a
    # fresh database already has this -- same guard as revisions 0017 to 0020.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "adminaction" in set(inspector.get_table_names()):
        return

    op.create_table(
        "adminaction",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        # Kept alongside the id so "who did this" survives the actor's account
        # being renamed or removed.
        sa.Column("actor_email", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target_user_id", sa.Integer(), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["target_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_adminaction_actor_user_id", "adminaction", ["actor_user_id"])
    op.create_index("ix_adminaction_target_user_id", "adminaction", ["target_user_id"])
    op.create_index("ix_adminaction_action", "adminaction", ["action"])
    op.create_index("ix_adminaction_occurred_at", "adminaction", ["occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_adminaction_occurred_at", table_name="adminaction")
    op.drop_index("ix_adminaction_action", table_name="adminaction")
    op.drop_index("ix_adminaction_target_user_id", table_name="adminaction")
    op.drop_index("ix_adminaction_actor_user_id", table_name="adminaction")
    op.drop_table("adminaction")
