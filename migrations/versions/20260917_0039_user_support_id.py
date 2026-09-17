"""Add User.support_id: a random 8-digit code a user can quote to support
instead of their email address.

Revision ID: 20260917_0039
Revises: 20260914_0038
"""

import secrets

import sqlalchemy as sa
from alembic import op

revision = "20260917_0039"
down_revision = "20260914_0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("user")}
    if "support_id" not in columns:
        op.add_column("user", sa.Column("support_id", sa.String(length=8), nullable=True))

    # Every existing row needs a value before the column can become NOT NULL
    # and uniquely indexed -- generated the same way generate_support_id()
    # does, just checked against this batch instead of a live session.
    user_table = sa.table("user", sa.column("id", sa.Integer), sa.column("support_id", sa.String))
    used = {
        row.support_id
        for row in bind.execute(sa.select(user_table.c.support_id).where(user_table.c.support_id.is_not(None)))
    }
    pending = bind.execute(sa.select(user_table.c.id).where(user_table.c.support_id.is_(None))).fetchall()
    for row in pending:
        while True:
            candidate = f"{secrets.randbelow(10**8):08d}"
            if candidate not in used:
                used.add(candidate)
                break
        bind.execute(user_table.update().where(user_table.c.id == row.id).values(support_id=candidate))

    with op.batch_alter_table("user") as batch:
        batch.alter_column("support_id", nullable=False)

    existing_indexes = {index["name"] for index in inspector.get_indexes("user")}
    if "ix_user_support_id" not in existing_indexes:
        op.create_index("ix_user_support_id", "user", ["support_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_support_id", table_name="user")
    op.drop_column("user", "support_id")
