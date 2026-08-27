"""Add Subscription.payment_failed_at, for the payment-failure grace period.

Revision ID: 20260827_0024
Revises: 20260827_0023
"""

import sqlalchemy as sa
from alembic import op

revision = "20260827_0024"
down_revision = "20260827_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline from current SQLModel metadata, so a
    # fresh database already has this -- same guard as revisions 0017 to 0023.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("subscription")}
    if "payment_failed_at" in columns:
        return

    op.add_column("subscription", sa.Column("payment_failed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("subscription", "payment_failed_at")
