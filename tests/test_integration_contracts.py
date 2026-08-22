from alembic.config import Config
from alembic.script import ScriptDirectory
from kall.main import app
from kall.models import CareerGoal
from kall.router_registry import API_ROUTERS
from kall.services.opportunities import analyze_growth_market
from sqlmodel import SQLModel


def _app_paths() -> set[str]:
    return set(app.openapi()["paths"].keys())


def test_router_registry_is_complete() -> None:
    paths = _app_paths()
    expected = {
        "/api/testimonials/requests",
        "/api/testimonials/profile-card",
        "/api/applications/{application_id}/review",
        "/api/opportunities",
    }
    assert expected.issubset(paths)
    assert len(API_ROUTERS) >= 12


def test_opportunity_service_uses_restored_career_goal_model() -> None:
    assert analyze_growth_market.__annotations__["goal"] is CareerGoal


def test_model_metadata_resolves_all_foreign_keys() -> None:
    table_names = {table.name for table in SQLModel.metadata.sorted_tables}
    assert "careergoal" in table_names
    assert "growthmarketsignal" in table_names


def test_initial_migration_uses_frozen_v03_table_scope() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    initial = script.get_revision("20260802_0001").module
    baseline = set(initial.BASELINE_TABLE_NAMES)

    assert "user" in baseline
    assert "application" in baseline
    assert "onboardingprogress" not in baseline
    assert "careergoal" not in baseline
    assert "subscription" not in baseline


def test_tailoring_migration_does_not_create_later_tables() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    tailoring = script.get_revision("20260802_0005").module
    table_names = set(tailoring.TAILORING_TABLE_NAMES)

    assert table_names == {
        "tailoringproposal",
        "tailoringchange",
        "tailoringaudit",
    }
    assert "documenttemplate" not in table_names
    assert "careergoal" not in table_names
    assert "subscription" not in table_names


def test_opportunity_migration_targets_career_goal_table() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    opportunities = script.get_revision("20260802_0008").module

    assert opportunities.GROWTH_GOAL_TABLE == "careergoal"
    assert opportunities.GROWTH_GOAL_TABLE in SQLModel.metadata.tables
    assert "growthgoal" not in SQLModel.metadata.tables


def test_alembic_revision_chain_is_complete_and_has_single_head() -> None:
    config = Config("alembic.ini")
    script = ScriptDirectory.from_config(config)

    # Walking from each head forces Alembic to resolve every down_revision.
    # This catches missing intermediate migration files, not just split heads.
    heads = script.get_heads()
    assert len(heads) == 1
    revisions = list(script.walk_revisions(base="base", head=heads[0]))
    revision_ids = {revision.revision for revision in revisions}

    assert "20260802_0007" in revision_ids
    assert "20260802_0013" in revision_ids
