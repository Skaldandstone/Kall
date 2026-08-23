"""Add growth skill assessments.

Revision ID: 20260802_0015
Revises: 20260802_0014
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0015"
down_revision = "20260802_0014"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "growthskillassessment",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("career_goal_id", sa.Integer(), sa.ForeignKey("careergoal.id"), nullable=False),
        sa.Column("answer_text", sa.String(), nullable=False),
        sa.Column("applicable_skills", sa.JSON(), nullable=False),
        sa.Column("gaps", sa.JSON(), nullable=False),
        sa.Column("readiness_score", sa.Integer(), nullable=False),
        sa.Column("narrative", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_growthskillassessment_user_id", "growthskillassessment", ["user_id"])
    op.create_index("ix_growthskillassessment_career_goal_id", "growthskillassessment", ["career_goal_id"])


def downgrade() -> None:
    op.drop_index("ix_growthskillassessment_career_goal_id", table_name="growthskillassessment")
    op.drop_index("ix_growthskillassessment_user_id", table_name="growthskillassessment")
    op.drop_table("growthskillassessment")
