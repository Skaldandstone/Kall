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
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_login_is_rate_limited_after_repeated_attempts(client: TestClient) -> None:
    responses = [
        client.post("/api/auth/login", json={"email": "nope@example.com", "password": "wrong"}).status_code
        for _ in range(11)
    ]
    assert responses[:10] == [401] * 10
    assert responses[10] == 429


def test_register_is_rate_limited_after_repeated_attempts(client: TestClient) -> None:
    responses = [
        client.post(
            "/api/auth/register",
            json={"email": f"spam{i}@example.com", "password": "SpamPassword123!", "full_name": "Spam"},
        ).status_code
        for i in range(6)
    ]
    assert responses[:5] == [200] * 5
    assert responses[5] == 429
