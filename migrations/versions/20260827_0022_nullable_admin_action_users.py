"""Make AdminAction's actor/target user columns nullable.

Revision ID: 20260827_0022
Revises: 20260802_0021
"""

import sqlalchemy as sa
from alembic import op

revision = "20260827_0022"
down_revision = "20260802_0021"
branch_labels = None
depends_on = None

# Account deletion nulls these columns rather than deleting the audit row --
# actor_email already exists to survive the actor's own account being
# removed, and the target deserves the same: the record of a support action
# should not disappear because the account it concerns is gone. Making an
# already-nullable column nullable again is a no-op, so this needs no
# inspector guard the way a fresh-database-already-has-this migration would.


def upgrade() -> None:
    with op.batch_alter_table("adminaction") as batch:
        batch.alter_column("actor_user_id", existing_type=sa.Integer(), nullable=True)
        batch.alter_column("target_user_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("adminaction") as batch:
        batch.alter_column("actor_user_id", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("target_user_id", existing_type=sa.Integer(), nullable=False)
