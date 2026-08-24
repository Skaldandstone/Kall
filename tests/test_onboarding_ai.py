from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from kall.db import get_session
from kall.main import app
from kall.services.onboarding_ai import suggest_career_strategy
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


def test_suggest_career_strategy_returns_none_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from kall.config import get_settings

    get_settings.cache_clear()
    assert suggest_career_strategy("Director of Quality Engineering, ten years leading test automation.") is None
    get_settings.cache_clear()


def test_suggest_career_strategy_returns_none_for_empty_resume_text(monkeypatch: pytest.MonkeyPatch) -> None:
    from kall.config import get_settings

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    get_settings.cache_clear()
    try:
        assert suggest_career_strategy("") is None
        assert suggest_career_strategy("   ") is None
    finally:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        get_settings.cache_clear()


def test_suggest_career_strategy_parses_a_canned_response(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx
    from kall.config import get_settings

    class FakeResponse:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "output_text": (
                    '{"summary": "Quality leader.", "target_titles": ["Director of Quality Engineering"], '
                    '"industries": ["Games"], "keywords": ["test automation", "CI/CD"], "work_types": ["remote"]}'
                )
            }

    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: FakeResponse())
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    get_settings.cache_clear()
    try:
        result = suggest_career_strategy("Director of Quality Engineering, remote, ten years in games.")
    finally:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        get_settings.cache_clear()

    assert result is not None
    assert result["target_titles"] == ["Director of Quality Engineering"]
    assert result["work_types"] == ["remote"]


@pytest.fixture
def client() -> Iterator[TestClient]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def override_get_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        with TestClient(app) as test_client:
            register = test_client.post(
                "/api/auth/register",
                json={"email": "onboarding-ai@example.com", "password": "TestPassword123!", "full_name": "Onboarding Test"},
            )
            test_client.headers["Authorization"] = f"Bearer {register.json()['access_token']}"
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_suggest_strategy_endpoint_without_api_key_returns_no_suggestion(client: TestClient) -> None:
    upload = client.post(
        "/api/me/resumes",
        files={"file": ("resume.txt", b"Director of Quality Engineering. Ten years leading automation.", "text/plain")},
    )
    resume_id = upload.json()["id"]

    response = client.post(f"/api/me/resumes/{resume_id}/suggest-strategy")
    assert response.status_code == 200
    body = response.json()
    assert body["ai_enabled"] is False
    assert body["suggestion"] is None


def test_suggest_strategy_endpoint_rejects_other_users_resume(client: TestClient) -> None:
    upload = client.post(
        "/api/me/resumes",
        files={"file": ("resume.txt", b"Director of Quality Engineering.", "text/plain")},
    )
    resume_id = upload.json()["id"]

    other_token = client.post(
        "/api/auth/register",
        json={"email": "other-onboarding-ai@example.com", "password": "TestPassword123!", "full_name": "Other User"},
    ).json()["access_token"]

    response = client.post(
        f"/api/me/resumes/{resume_id}/suggest-strategy",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert response.status_code == 404
