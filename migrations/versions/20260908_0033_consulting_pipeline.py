"""Add private consulting pipeline records.

Revision ID: 20260908_0033
Revises: 20260905_0032
"""

import sqlalchemy as sa
from alembic import op

revision = "20260908_0033"
down_revision = "20260905_0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if "consultinglead" not in existing:
        op.create_table(
            "consultinglead",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
            sa.Column("contact_id", sa.Integer(), sa.ForeignKey("contact.id"), nullable=True),
            sa.Column("organization", sa.String(), nullable=False),
            sa.Column("opportunity_name", sa.String(), nullable=False),
            sa.Column("relationship_segment", sa.String(), nullable=False),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("source_url", sa.String(), nullable=True),
            sa.Column("service_line", sa.String(), nullable=True),
            sa.Column("stage", sa.String(), nullable=False),
            sa.Column("projected_value_cents", sa.Integer(), nullable=True),
            sa.Column("currency", sa.String(), nullable=False),
            sa.Column("next_step", sa.String(), nullable=True),
            sa.Column("notes", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_consultinglead_user_id"), "consultinglead", ["user_id"])
        op.create_index(op.f("ix_consultinglead_contact_id"), "consultinglead", ["contact_id"])
        op.create_index(op.f("ix_consultinglead_relationship_segment"), "consultinglead", ["relationship_segment"])
        op.create_index(op.f("ix_consultinglead_stage"), "consultinglead", ["stage"])

    if "consultingproposal" not in existing:
        op.create_table(
            "consultingproposal",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
            sa.Column("lead_id", sa.Integer(), sa.ForeignKey("consultinglead.id"), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("summary", sa.String(), nullable=True),
            sa.Column("scope", sa.String(), nullable=True),
            sa.Column("deliverables", sa.JSON(), nullable=False),
            sa.Column("fee_cents", sa.Integer(), nullable=True),
            sa.Column("currency", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("approved_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_consultingproposal_user_id"), "consultingproposal", ["user_id"])
        op.create_index(op.f("ix_consultingproposal_lead_id"), "consultingproposal", ["lead_id"])
        op.create_index(op.f("ix_consultingproposal_status"), "consultingproposal", ["status"])

    if "consultingfollowup" not in existing:
        op.create_table(
            "consultingfollowup",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
            sa.Column("lead_id", sa.Integer(), sa.ForeignKey("consultinglead.id"), nullable=False),
            sa.Column("due_on", sa.Date(), nullable=False),
            sa.Column("channel", sa.String(), nullable=False),
            sa.Column("purpose", sa.String(), nullable=False),
            sa.Column("draft_message", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("approved_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_consultingfollowup_user_id"), "consultingfollowup", ["user_id"])
        op.create_index(op.f("ix_consultingfollowup_lead_id"), "consultingfollowup", ["lead_id"])
        op.create_index(op.f("ix_consultingfollowup_status"), "consultingfollowup", ["status"])

    if "consultingengagement" not in existing:
        op.create_table(
            "consultingengagement",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
            sa.Column("lead_id", sa.Integer(), sa.ForeignKey("consultinglead.id"), nullable=True),
            sa.Column("client_name", sa.String(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("service_line", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("scope", sa.String(), nullable=True),
            sa.Column("fee_cents", sa.Integer(), nullable=True),
            sa.Column("currency", sa.String(), nullable=False),
            sa.Column("starts_on", sa.Date(), nullable=True),
            sa.Column("ends_on", sa.Date(), nullable=True),
            sa.Column("design_partner_product", sa.String(), nullable=True),
            sa.Column("design_partner_stage", sa.String(), nullable=True),
            sa.Column("outcome_notes", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_consultingengagement_user_id"), "consultingengagement", ["user_id"])
        op.create_index(op.f("ix_consultingengagement_lead_id"), "consultingengagement", ["lead_id"])
        op.create_index(op.f("ix_consultingengagement_status"), "consultingengagement", ["status"])
        op.create_index(op.f("ix_consultingengagement_design_partner_product"), "consultingengagement", ["design_partner_product"])


def downgrade() -> None:
    op.drop_table("consultingengagement")
    op.drop_table("consultingfollowup")
    op.drop_table("consultingproposal")
    op.drop_table("consultinglead")
