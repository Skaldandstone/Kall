"""Add scoped customer binding and resumable Checkout identity.

Revision ID: 20260831_0029
Revises: 20260830_0028
"""

import sqlalchemy as sa
from alembic import op

revision = "20260831_0029"
down_revision = "20260830_0028"
branch_labels = None
depends_on = None

COLUMNS = [
    sa.Column("billing_scope", sa.String(), nullable=True),
    sa.Column("provider_livemode", sa.Boolean(), nullable=True),
    sa.Column("billing_binding_key", sa.String(), nullable=True),
    sa.Column("billing_binding_created_at", sa.DateTime(), nullable=True),
    sa.Column("checkout_attempt_key", sa.String(), nullable=True),
    sa.Column("checkout_plan", sa.String(), nullable=True),
    sa.Column("checkout_session_id", sa.String(), nullable=True),
    sa.Column("checkout_expires_at", sa.DateTime(), nullable=True),
]


def upgrade() -> None:
    # No existing customer is silently promoted to a trusted scoped binding.
    with op.batch_alter_table("subscription") as batch:
        for column in COLUMNS:
            batch.add_column(column)
        batch.create_unique_constraint("uq_subscription_scope_customer", ["billing_scope", "provider_customer_id"])
        batch.create_unique_constraint("uq_subscription_scope_subscription", ["billing_scope", "provider_subscription_id"])


def downgrade() -> None:
    with op.batch_alter_table("subscription") as batch:
        batch.drop_constraint("uq_subscription_scope_subscription", type_="unique")
        batch.drop_constraint("uq_subscription_scope_customer", type_="unique")
        for column in reversed(COLUMNS):
            batch.drop_column(column.name)
