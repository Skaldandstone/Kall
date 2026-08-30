"""Bounded company-board monitoring and reliable notification claims.

Revision ID: 20260830_0028
Revises: 20260828_0027
"""

import sqlalchemy as sa
from alembic import op

revision = "20260830_0028"
down_revision = "20260828_0027"
branch_labels = None
depends_on = None


def _timestamps():
    return [sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False)]


def upgrade() -> None:
    bind = op.get_bind()
    for table, columns in {
        "discoveryschedule": [sa.Column("last_success_at", sa.DateTime()), sa.Column("last_error", sa.String()), sa.Column("monitoring_cycle_at", sa.DateTime())],
        "notificationdelivery": [sa.Column("claimed_until", sa.DateTime()), sa.Column("provider_message_id", sa.String())],
    }.items():
        present = {c["name"] for c in sa.inspect(bind).get_columns(table)}
        for column in columns:
            if column.name not in present:
                op.add_column(table, column)

    op.create_table("monitoringlease",
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id")),
                    sa.Column("key", sa.String(), primary_key=True),
                    sa.Column("token", sa.String()),
                    sa.Column("expires_at", sa.DateTime(), nullable=False))
    op.create_index("ix_monitoringlease_user_id", "monitoringlease", ["user_id"])
    op.create_table("publicboardfeed", *_timestamps(),
                    sa.Column("key", sa.String(), primary_key=True),
                    sa.Column("provider", sa.String(), nullable=False),
                    sa.Column("board_key", sa.String(), nullable=False),
                    sa.Column("jobs", sa.JSON(), nullable=False),
                    sa.Column("version", sa.String(), nullable=False),
                    sa.Column("etag", sa.String()), sa.Column("last_modified", sa.String()),
                    sa.Column("last_checked_at", sa.DateTime()), sa.Column("last_success_at", sa.DateTime()),
                    sa.Column("next_poll_at", sa.DateTime()), sa.Column("failures", sa.Integer(), nullable=False),
                    sa.Column("last_error", sa.String()), sa.Column("response_bytes", sa.Integer(), nullable=False))
    op.create_table("scheduleboardstate", *_timestamps(),
                    sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("schedule_id", sa.Integer(), sa.ForeignKey("discoveryschedule.id"), nullable=False),
                    sa.Column("feed_key", sa.String(), sa.ForeignKey("publicboardfeed.key"), nullable=False),
                    sa.Column("initialized", sa.Boolean(), nullable=False),
                    sa.Column("version", sa.String(), nullable=False),
                    sa.Column("criteria_version", sa.String(), nullable=False),
                    sa.Column("cursor", sa.Integer(), nullable=False),
                    sa.Column("cycle_at", sa.DateTime()), sa.Column("completed_cycle_at", sa.DateTime()),
                    sa.Column("last_success_at", sa.DateTime()),
                    sa.UniqueConstraint("schedule_id", "feed_key", name="uq_schedule_board"))
    op.create_index("ix_scheduleboardstate_schedule_id", "scheduleboardstate", ["schedule_id"])
    op.create_table("monitoringobservation", *_timestamps(),
                    sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("board_state_id", sa.Integer(), sa.ForeignKey("scheduleboardstate.id"), nullable=False),
                    sa.Column("job_id", sa.Integer(), sa.ForeignKey("job.id"), nullable=False),
                    sa.Column("fingerprint", sa.String(), nullable=False),
                    sa.Column("qualifying", sa.Boolean(), nullable=False),
                    sa.UniqueConstraint("board_state_id", "job_id", name="uq_monitoring_observation"))
    op.create_index("ix_monitoringobservation_board_state_id", "monitoringobservation", ["board_state_id"])
    op.create_index("ix_monitoringobservation_job_id", "monitoringobservation", ["job_id"])
    op.create_table("opportunitynotificationevent", *_timestamps(),
                    sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
                    sa.Column("job_id", sa.Integer(), sa.ForeignKey("job.id"), nullable=False),
                    sa.Column("fingerprint", sa.String(), nullable=False),
                    sa.Column("status", sa.String(), nullable=False),
                    sa.Column("delivery_id", sa.Integer(), sa.ForeignKey("notificationdelivery.id")),
                    sa.UniqueConstraint("user_id", "job_id", "fingerprint", name="uq_opportunity_notification_event"))
    for column in ("user_id", "job_id", "status", "delivery_id"):
        op.create_index(f"ix_opportunitynotificationevent_{column}", "opportunitynotificationevent", [column])


def downgrade() -> None:
    for table in ("opportunitynotificationevent", "monitoringobservation", "scheduleboardstate", "publicboardfeed", "monitoringlease"):
        op.drop_table(table)
    for table, names in {"notificationdelivery": ("claimed_until", "provider_message_id"),
                         "discoveryschedule": ("last_success_at", "last_error", "monitoring_cycle_at")}.items():
        with op.batch_alter_table(table) as batch:
            for name in names:
                batch.drop_column(name)
