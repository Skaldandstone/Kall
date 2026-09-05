"""Add CareerProfile.cities and CareerProfile.pay_basis.

Revision ID: 20260905_0032
Revises: 20260904_0031
"""

import sqlalchemy as sa
from alembic import op

revision = "20260905_0032"
down_revision = "20260904_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("careerprofile")}
    if "cities" not in columns:
        op.add_column(
            "careerprofile",
            sa.Column("cities", sa.JSON(), nullable=False, server_default="[]"),
        )
    if "pay_basis" not in columns:
        op.add_column(
            "careerprofile",
            sa.Column("pay_basis", sa.String(), nullable=False, server_default="salary"),
        )


def downgrade() -> None:
    with op.batch_alter_table("careerprofile") as batch:
        batch.drop_column("pay_basis")
        batch.drop_column("cities")
