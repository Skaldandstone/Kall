"""Add the shareable career page.

Revision ID: 20260802_0019
Revises: 20260802_0018
"""

import sqlalchemy as sa
from alembic import op

revision = "20260802_0019"
down_revision = "20260802_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 builds its baseline from current SQLModel metadata, so a
    # fresh database already has these -- same guard as revisions 0017 and 0018.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "careerpage" not in tables:
        op.create_table(
            "careerpage",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("slug", sa.String(), nullable=False),
            sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("display_name", sa.String(), nullable=True),
            sa.Column("headline", sa.String(), nullable=True),
            sa.Column("summary", sa.String(), nullable=True),
            sa.Column("location", sa.String(), nullable=True),
            sa.Column("theme", sa.String(), nullable=False, server_default="parchment"),
            sa.Column("links", sa.JSON(), nullable=True),
            sa.Column("published_at", sa.DateTime(), nullable=True),
            sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", name="uq_careerpage_user"),
            sa.UniqueConstraint("slug", name="uq_careerpage_slug"),
        )
        op.create_index("ix_careerpage_user_id", "careerpage", ["user_id"])
        op.create_index("ix_careerpage_slug", "careerpage", ["slug"])

    if "careerpagesection" not in tables:
        op.create_table(
            "careerpagesection",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("career_page_id", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("body", sa.String(), nullable=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("visible", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("item_ids", sa.JSON(), nullable=True),
            sa.Column("layout", sa.String(), nullable=False, server_default="list"),
            sa.Column("options", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
            sa.ForeignKeyConstraint(["career_page_id"], ["careerpage.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_careerpagesection_user_id", "careerpagesection", ["user_id"])
        op.create_index("ix_careerpagesection_page", "careerpagesection", ["career_page_id"])


def downgrade() -> None:
    op.drop_index("ix_careerpagesection_page", table_name="careerpagesection")
    op.drop_index("ix_careerpagesection_user_id", table_name="careerpagesection")
    op.drop_table("careerpagesection")
    op.drop_index("ix_careerpage_slug", table_name="careerpage")
    op.drop_index("ix_careerpage_user_id", table_name="careerpage")
    op.drop_table("careerpage")
