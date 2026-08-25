from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from kall.db import get_session
from kall.main import app
from kall.models import ResumeDocument
from kall.services.intelligence import analyze_job, parse_resume
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


def test_resume_parser_extracts_verified_source_candidates() -> None:
    parsed, warnings = parse_resume(
        """PROFESSIONAL EXPERIENCE
Director of Quality Engineering
Led a global team of 40 engineers and increased automation coverage to 80%.
SKILLS
Python AWS Playwright CI/CD
"""
    )
    assert "python" in parsed["skills"]
    assert "aws" in parsed["skills"]
    assert parsed["achievements"][0]["metrics"] == ["40", "80%"]
    assert not warnings


def test_job_analyzer_separates_explicit_and_inferred_signals() -> None:
    result = analyze_job(
        """Director of Engineering Excellence
Required: 10 years of leadership experience and Python.
Preferred: AWS certification and Kubernetes.
You will lead quality strategy across the organization.
"""
    )
    assert "python" in result["required_skills"]
    assert "kubernetes" in result["preferred_skills"]
    assert "director" in result["leadership_signals"]
    assert result["explicit_requirements"]
    assert result["inferred_signals"]


def test_parser_does_not_invent_metrics() -> None:
    parsed, _ = parse_resume("Improved release quality across the platform.")
    assert parsed["achievements"] == []


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
                json={"email": "resume-parse-test@example.com", "password": "TestPassword123!", "full_name": "Parse Test"},
            )
            test_client.headers["Authorization"] = f"Bearer {register.json()['access_token']}"
            with Session(engine) as session:
                resume = ResumeDocument(
                    user_id=register.json()["user_id"],
                    name="resume.txt",
                    file_path="uploads/1/resume.txt",
                    mime_type="text/plain",
                    extracted_text="Director of Quality Engineering\nLed a global team of 40 engineers and increased automation coverage to 80%.",
                )
                session.add(resume)
                session.commit()
                session.refresh(resume)
                test_client.resume_id = resume.id  # type: ignore[attr-defined]
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_parse_endpoint_response_survives_the_achievement_insert_commit(client: TestClient) -> None:
    """Regression: parse_resume_endpoint commits once to save the ResumeParse
    row, then commits again after inserting Achievement rows. That second
    commit expires every object the session has already loaded (including
    the ResumeParse row about to be returned) -- without a refresh right
    before returning it, FastAPI serialized an object with expired
    attributes and silently produced an empty `{}` response body instead of
    a real error or the actual parse result."""
    response = client.post(f"/api/intelligence/resumes/{client.resume_id}/parse")  # type: ignore[attr-defined]
    assert response.status_code == 200
    body = response.json()
    assert body["resume_id"] == client.resume_id  # type: ignore[attr-defined]
    assert body["warnings"] == []
    assert body["parsed_json"]["achievements"][0]["metrics"] == ["40", "80%"]
