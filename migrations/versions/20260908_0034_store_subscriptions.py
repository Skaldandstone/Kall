"""Add provider-neutral store subscription records.

Revision ID: 20260908_0034
Revises: 20260908_0033
"""

import sqlalchemy as sa
from alembic import op

revision = "20260908_0034"
down_revision = "20260908_0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "storesubscription" in set(sa.inspect(bind).get_table_names()):
        return
    op.create_table(
        "storesubscription",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("store", sa.String(), nullable=False),
        sa.Column("environment", sa.String(), nullable=False),
        sa.Column("original_transaction_id", sa.String(), nullable=False),
        sa.Column("product_id", sa.String(), nullable=False),
        sa.Column("plan", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("active_until", sa.DateTime(), nullable=True),
        sa.Column("will_renew", sa.Boolean(), nullable=False),
        sa.Column("last_event_at", sa.DateTime(), nullable=False),
        sa.Column("last_provider_event_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider", "original_transaction_id", name="uq_store_subscription_transaction"
        ),
    )
    for column in (
        "user_id",
        "store",
        "environment",
        "original_transaction_id",
        "product_id",
        "last_provider_event_id",
    ):
        op.create_index(op.f(f"ix_storesubscription_{column}"), "storesubscription", [column])


def downgrade() -> None:
    op.drop_table("storesubscription")
