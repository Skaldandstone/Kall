
import pytest
from fastapi.testclient import TestClient
from kall.models import ResumeDocument, User
from kall.services.onboarding_ai import suggest_career_strategy
from sqlmodel import Session


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


def test_suggest_strategy_endpoint_without_api_key_falls_back_to_a_deterministic_guess(client: TestClient) -> None:
    upload = client.post(
        "/api/me/resumes",
        files={"file": ("resume.txt", b"Director of Quality Engineering\n2018 - Present\nLed test automation.", "text/plain")},
    )
    resume_id = upload.json()["id"]

    response = client.post(f"/api/me/resumes/{resume_id}/suggest-strategy")
    assert response.status_code == 200
    body = response.json()
    assert body["ai_enabled"] is False
    assert body["suggestion"] is not None
    assert "Director of Quality Engineering" in body["suggestion"]["target_titles"]
    assert "quality engineering" in body["suggestion"]["keywords"]


def test_suggest_strategy_endpoint_without_api_key_or_signal_returns_no_suggestion(client: TestClient) -> None:
    upload = client.post(
        "/api/me/resumes",
        files={"file": ("resume.txt", b"A short document with no known skills or dated roles in it.", "text/plain")},
    )
    resume_id = upload.json()["id"]

    response = client.post(f"/api/me/resumes/{resume_id}/suggest-strategy")
    assert response.status_code == 200
    body = response.json()
    assert body["ai_enabled"] is False
    assert body["suggestion"] is None


def test_suggest_strategy_endpoint_rejects_other_users_resume(client: TestClient, engine) -> None:
    # The signed-in user has a resume of their own, so a 404 below cannot pass
    # just because no resumes exist.
    client.post("/api/me/resumes", files={"file": ("mine.txt", b"Director of Quality Engineering.", "text/plain")})

    with Session(engine) as session:
        other = User(clerk_user_id="user_other_onboarding", email="other-onboarding@example.com", full_name="Other User")
        session.add(other)
        session.commit()
        session.refresh(other)
        theirs = ResumeDocument(user_id=other.id, name="theirs.txt",
                                file_path="uploads/other/theirs.txt", mime_type="text/plain")
        session.add(theirs)
        session.commit()
        session.refresh(theirs)
        theirs_id = theirs.id

    response = client.post(f"/api/me/resumes/{theirs_id}/suggest-strategy")
    assert response.status_code == 404
