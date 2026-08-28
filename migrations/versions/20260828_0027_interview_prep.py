"""Add InterviewPrep: a question bank plus notes per application.

Revision ID: 20260828_0027
Revises: 20260828_0026
"""

import sqlalchemy as sa
from alembic import op

revision = "20260828_0027"
down_revision = "20260828_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "interviewprep" in set(inspector.get_table_names()):
        return

    op.create_table(
        "interviewprep",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("application.id"), nullable=False),
        sa.Column("questions", sa.JSON(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("application_id"),
    )
    op.create_index(op.f("ix_interviewprep_user_id"), "interviewprep", ["user_id"])
    op.create_index(op.f("ix_interviewprep_application_id"), "interviewprep", ["application_id"])


def downgrade() -> None:
    op.drop_table("interviewprep")
