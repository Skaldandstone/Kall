"""Add plan usage meters and the premium tier.

Revision ID: 20260802_0020
Revises: 20260802_0019
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0020"
down_revision = "20260802_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline from current SQLModel metadata, so a
    # fresh database already has these -- same guard as revisions 0017 to 0019.
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "usagecounter" not in set(inspector.get_table_names()):
        op.create_table(
            "usagecounter",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("meter", sa.String(), nullable=False),
            sa.Column("period", sa.String(), nullable=False),
            sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "meter", "period", name="uq_usagecounter_user_meter_period"),
        )
        op.create_index("ix_usagecounter_user_id", "usagecounter", ["user_id"])
        op.create_index("ix_usagecounter_meter", "usagecounter", ["meter"])
        op.create_index("ix_usagecounter_period", "usagecounter", ["period"])

    if "byte_size" not in {c["name"] for c in inspector.get_columns("resumedocument")}:
        op.add_column(
            "resumedocument",
            sa.Column("byte_size", sa.Integer(), nullable=False, server_default="0"),
        )

    # Carry the pre-existing lifetime application count into the new counter,
    # so nobody's allowance silently resets to zero on deploy.
    op.execute(
        """
        INSERT INTO usagecounter (user_id, meter, period, used, created_at, updated_at)
        SELECT id, 'applications', 'lifetime', completed_application_count,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "user"
        WHERE completed_application_count > 0
        """
    )


def downgrade() -> None:
    op.drop_column("resumedocument", "byte_size")
    op.drop_index("ix_usagecounter_period", table_name="usagecounter")
    op.drop_index("ix_usagecounter_meter", table_name="usagecounter")
    op.drop_index("ix_usagecounter_user_id", table_name="usagecounter")
    op.drop_table("usagecounter")
