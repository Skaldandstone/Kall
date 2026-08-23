from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from kall.db import get_session
from kall.main import app
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine


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
                json={"email": "resume-upload@example.com", "password": "TestPassword123!", "full_name": "Resume Upload"},
            )
            test_client.headers["Authorization"] = f"Bearer {register.json()['access_token']}"
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_rejects_disallowed_file_extension(client: TestClient) -> None:
    response = client.post("/api/me/resumes", files={"file": ("resume.exe", b"not a resume", "application/octet-stream")})
    assert response.status_code == 415


def test_rejects_oversized_file(client: TestClient) -> None:
    oversized = b"x" * (15 * 1024 * 1024 + 1)
    response = client.post("/api/me/resumes", files={"file": ("resume.txt", oversized, "text/plain")})
    assert response.status_code == 413


def test_accepts_a_reasonable_text_resume(client: TestClient) -> None:
    response = client.post("/api/me/resumes", files={"file": ("resume.txt", b"Jordan Smith\nSenior Engineer", "text/plain")})
    assert response.status_code == 200
    assert response.json()["file_path"] == "uploads/1/resume.txt"
