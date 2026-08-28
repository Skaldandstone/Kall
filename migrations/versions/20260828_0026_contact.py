"""Add Contact: private networking notes, distinct from Reference.

Revision ID: 20260828_0026
Revises: 20260827_0025
"""

import sqlalchemy as sa
from alembic import op

revision = "20260828_0026"
down_revision = "20260827_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "contact" in set(inspector.get_table_names()):
        return

    op.create_table(
        "contact",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("company", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("relationship", sa.String(), nullable=True),
        sa.Column("contact_email", sa.String(), nullable=True),
        sa.Column("linkedin_url", sa.String(), nullable=True),
        sa.Column("contact_notes", sa.String(), nullable=True),
        sa.Column("last_contacted_on", sa.Date(), nullable=True),
        sa.Column("follow_up_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_contact_user_id"), "contact", ["user_id"])


def downgrade() -> None:
    op.drop_table("contact")
