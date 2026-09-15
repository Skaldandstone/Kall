"""Add EmailDetectedEvent: proposed application-status signals from a mailbox.

Revision ID: 20260914_0038
Revises: 20260914_0037
"""

import sqlalchemy as sa
from alembic import op

revision = "20260914_0038"
down_revision = "20260914_0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "emaildetectedevent" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "emaildetectedevent",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("connection_id", sa.Integer(), sa.ForeignKey("emailconnection.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("application.id"), nullable=True),
        sa.Column("external_message_id", sa.String(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_emaildetectedevent_connection_id"), "emaildetectedevent", ["connection_id"], unique=False)
    op.create_index(op.f("ix_emaildetectedevent_user_id"), "emaildetectedevent", ["user_id"], unique=False)
    op.create_index(op.f("ix_emaildetectedevent_external_message_id"), "emaildetectedevent", ["external_message_id"], unique=False)


def downgrade() -> None:
    op.drop_table("emaildetectedevent")
