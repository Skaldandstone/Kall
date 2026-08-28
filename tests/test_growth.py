
import pytest
from fastapi.testclient import TestClient
from kall.models import CareerGoal
from kall.services.growth_ai import analyze_skills, generate_ai_plan


def _goal(**overrides) -> CareerGoal:
    defaults = dict(user_id=1, title="Move into game art", target_role="Environment Artist", target_industry="Games")
    defaults.update(overrides)
    return CareerGoal(**defaults)


def test_generate_ai_plan_returns_none_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from kall.config import get_settings

    get_settings.cache_clear()
    assert generate_ai_plan(_goal(), "") is None
    assert analyze_skills(_goal(), "I know Blender.", "") is None
    get_settings.cache_clear()


def test_generate_ai_plan_parses_a_canned_response(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx
    from kall.config import get_settings

    class FakeResponse:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "output_text": (
                    '{"summary": "A plan.", "current_strengths": ["Grit"], "skill_gaps": ["Portfolio"], '
                    '"recommended_roles": ["Environment Artist"], "milestones": ['
                    '{"phase": "Foundation", "title": "Map the role", "description": "Research.", '
                    '"category": "research", "estimated_hours": 4}]}'
                )
            }

    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: FakeResponse())
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    get_settings.cache_clear()
    try:
        result = generate_ai_plan(_goal(), "")
    finally:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        get_settings.cache_clear()

    assert result is not None
    assert result["summary"] == "A plan."
    assert result["milestones"][0]["title"] == "Map the role"


def _create_goal_and_plan(client: TestClient) -> tuple[int, dict]:
    goal = client.post(
        "/api/growth/goals",
        json={"title": "Move into game art", "target_role": "Environment Artist", "target_industry": "Games", "time_per_week_hours": 6},
    ).json()
    plan = client.post(f"/api/growth/goals/{goal['id']}/plan").json()
    return goal["id"], plan


def test_generate_plan_deterministic_fallback_produces_full_plan(client: TestClient) -> None:
    _goal_id, plan = _create_goal_and_plan(client)
    assert plan["plan"]["provider"] == "deterministic"
    assert len(plan["milestones"]) == 4
    assert len(plan["searches"]) == 4
    assert plan["skill_assessments"] == []


def test_generate_plan_is_idempotent_without_regenerate(client: TestClient) -> None:
    goal_id, first = _create_goal_and_plan(client)
    second = client.post(f"/api/growth/goals/{goal_id}/plan").json()
    assert first["plan"]["id"] == second["plan"]["id"]
    assert [m["id"] for m in first["milestones"]] == [m["id"] for m in second["milestones"]]


def test_regenerate_replaces_milestones_but_preserves_resources_and_progress(client: TestClient) -> None:
    goal_id, plan = _create_goal_and_plan(client)
    plan_id = plan["plan"]["id"]
    old_milestone_id = plan["milestones"][0]["id"]

    resource = client.post(
        f"/api/growth/plans/{plan_id}/resources",
        json={"url": "https://example.com/course", "title": "A great course", "description": "Found via search."},
    ).json()
    client.patch(f"/api/growth/resources/{resource['id']}", json={"saved": True})

    progress = client.post(
        f"/api/growth/plans/{plan_id}/progress",
        json={"milestone_id": old_milestone_id, "note": "Finished the intro module."},
    ).json()

    regenerated = client.post(f"/api/growth/goals/{goal_id}/plan", json={"regenerate": True}).json()

    assert regenerated["plan"]["id"] == plan_id
    # SQLite may recycle the old row id once every milestone for this plan is
    # deleted, so identity isn't a reliable regeneration signal here -- the
    # progress-entry detachment assertion below is what actually proves the
    # old milestone row was deleted, not just re-fetched.
    assert len(regenerated["milestones"]) == 4

    resources = regenerated["resources"]
    assert any(item["id"] == resource["id"] and item["saved"] is True for item in resources)

    progress_entries = regenerated["progress"]
    matching = next(item for item in progress_entries if item["id"] == progress["id"])
    assert matching["milestone_id"] is None


def test_import_resource_and_pin_ownership_checks(client: TestClient) -> None:
    _goal_id, plan = _create_goal_and_plan(client)
    plan_id = plan["plan"]["id"]

    imported = client.post(
        f"/api/growth/plans/{plan_id}/resources",
        json={"url": "https://example.com/guide", "title": "A guide"},
    )
    assert imported.status_code == 200
    assert imported.json()["saved"] is False

    pinned = client.patch(f"/api/growth/resources/{imported.json()['id']}", json={"saved": True})
    assert pinned.status_code == 200
    assert pinned.json()["saved"] is True

    assert client.post("/api/growth/plans/999999/resources", json={"url": "https://example.com/x", "title": "x"}).status_code == 404
    assert client.patch("/api/growth/resources/999999", json={"saved": True}).status_code == 404


def test_milestone_status_can_be_set_to_completed(client: TestClient) -> None:
    """Regression test: nothing anywhere ever wrote to GrowthMilestone.status
    or completed_at -- every milestone stayed "not_started" forever, with no
    way to mark one done."""
    _goal_id, plan = _create_goal_and_plan(client)
    milestone_id = plan["milestones"][0]["id"]

    response = client.patch(f"/api/growth/milestones/{milestone_id}", json={"status": "completed"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"
    assert response.json()["completed_at"] is not None


def test_milestone_status_clears_completed_at_when_moved_back(client: TestClient) -> None:
    _goal_id, plan = _create_goal_and_plan(client)
    milestone_id = plan["milestones"][0]["id"]
    client.patch(f"/api/growth/milestones/{milestone_id}", json={"status": "completed"})

    response = client.patch(f"/api/growth/milestones/{milestone_id}", json={"status": "in_progress"})
    assert response.status_code == 200
    assert response.json()["completed_at"] is None


def test_milestone_status_rejects_an_unsupported_value(client: TestClient) -> None:
    _goal_id, plan = _create_goal_and_plan(client)
    milestone_id = plan["milestones"][0]["id"]
    response = client.patch(f"/api/growth/milestones/{milestone_id}", json={"status": "abandoned"})
    assert response.status_code == 422


def test_milestone_status_ownership_check(client: TestClient) -> None:
    assert client.patch("/api/growth/milestones/999999", json={"status": "completed"}).status_code == 404


def test_skills_analysis_fallback_without_api_key(client: TestClient) -> None:
    goal_id, _plan = _create_goal_and_plan(client)
    response = client.post(f"/api/growth/goals/{goal_id}/skills-analysis", json={"answer": "I've built websites for 3 years."})
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "deterministic"
    assert 0 <= body["readiness_score"] <= 100
    assert body["narrative"]
