"""Add interview scheduling marker and richer interview prep content.

Revision ID: 20260904_0031
Revises: 20260904_0030
"""

import sqlalchemy as sa
from alembic import op

revision = "20260904_0031"
down_revision = "20260904_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline tables from *current* SQLModel
    # metadata (see 20260802_0014's identical guard), so a fresh database
    # already has these columns by the time this revision runs.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    application_columns = {column["name"] for column in inspector.get_columns("application")}
    if "interview_scheduled_at" not in application_columns:
        op.add_column("application", sa.Column("interview_scheduled_at", sa.DateTime(), nullable=True))

    prep_columns = {column["name"] for column in inspector.get_columns("interviewprep")}
    if "company_context" not in prep_columns:
        op.add_column(
            "interviewprep",
            sa.Column("company_context", sa.JSON(), nullable=False, server_default="{}"),
        )
    if "question_bank" not in prep_columns:
        op.add_column(
            "interviewprep",
            sa.Column("question_bank", sa.JSON(), nullable=False, server_default="[]"),
        )
    if "questions_to_ask" not in prep_columns:
        op.add_column(
            "interviewprep",
            sa.Column("questions_to_ask", sa.JSON(), nullable=False, server_default="[]"),
        )


def downgrade() -> None:
    with op.batch_alter_table("interviewprep") as batch:
        batch.drop_column("questions_to_ask")
        batch.drop_column("question_bank")
        batch.drop_column("company_context")
    with op.batch_alter_table("application") as batch:
        batch.drop_column("interview_scheduled_at")
