"""Initial Kall schema.

Revision ID: 20260802_0001
Revises:
"""
import kall.models  # noqa: F401
import sqlalchemy as sa
from alembic import op
from sqlmodel import SQLModel

revision = "20260802_0001"
down_revision = None
branch_labels = None
depends_on = None

# This revision originally shipped with Kall v0.3. Keep its table set frozen.
# Using all of SQLModel.metadata here makes the historical migration change every
# time a model is added, so later revisions attempt to create the same tables.
BASELINE_TABLE_NAMES = (
    "user",
    "fieldprivacy",
    "candidateprofile",
    "careerprofile",
    "resumedocument",
    "job",
    "jobmatch",
    "application",
    "reference",
    # usercredential and usersession were part of this baseline, but their
    # models were deleted when identity moved to Clerk (revision 0017), so
    # they cannot be built from metadata any more. They are created
    # explicitly below instead, keeping this revision's real table set intact
    # for a database built from scratch.
    "searchsource",
    "searchrun",
    "education",
    "skill",
    "certification",
    "securityclearance",
    "language",
    "awardhonor",
    "publication",
    "patent",
    "speakingengagement",
    "professionalmembership",
    "volunteerboardservice",
    "eeoprofile",
    "workauthorization",
)


def _baseline_tables():
    missing = [name for name in BASELINE_TABLE_NAMES if name not in SQLModel.metadata.tables]
    if missing:
        raise RuntimeError(f"Initial migration models are missing: {', '.join(missing)}")
    return [SQLModel.metadata.tables[name] for name in BASELINE_TABLE_NAMES]


def _create_retired_auth_tables() -> None:
    """Tables from this baseline whose models no longer exist (see revision 0017)."""
    op.create_table(
        "usercredential",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("verification_token_hash", sa.String(), nullable=True),
        sa.Column("reset_token_hash", sa.String(), nullable=True),
        sa.Column("reset_token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("failed_login_count", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.Column("totp_secret_encrypted", sa.String(), nullable=True),
        sa.Column("totp_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "usersession",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def upgrade() -> None:
    SQLModel.metadata.create_all(bind=op.get_bind(), tables=_baseline_tables())
    _create_retired_auth_tables()


def downgrade() -> None:
    op.drop_table("usersession")
    op.drop_table("usercredential")
    SQLModel.metadata.drop_all(bind=op.get_bind(), tables=_baseline_tables())
