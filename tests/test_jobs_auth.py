"""POST /api/jobs must require a signed-in user.

This route shipped without an auth dependency while every sibling had one,
and the ALB routes /api/* straight to FastAPI -- so it was an anonymous-write
hole into the jobs table. Job rows are shared (no owner column), which is why
the route requires sign-in but does not attribute the row to the caller.
"""

from collections.abc import Iterator

from fastapi.testclient import TestClient
from kall.db import get_session
from kall.main import app
from sqlmodel import Session

JOB_PAYLOAD = {
    "source": "manual",
    "company": "Acme",
    "title": "Engineer",
    "description": "Build things.",
    "url": "https://boards.example.com/jobs/acme-engineer",
}


def test_unauthenticated_job_creation_is_rejected(engine) -> None:
    """Only the DB is stubbed here -- get_current_user runs for real, so a
    request with no Authorization header must be refused before any row is
    written, exactly as it would be in production."""

    def override_get_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        with TestClient(app) as anonymous:
            response = anonymous.post("/api/jobs", json=JOB_PAYLOAD)
    finally:
        app.dependency_overrides.pop(get_session, None)

    assert response.status_code == 401


def test_a_signed_in_user_can_still_create_a_job(client: TestClient) -> None:
    response = client.post("/api/jobs", json=JOB_PAYLOAD)
    assert response.status_code == 200
    body = response.json()
    assert body["company"] == "Acme"
    assert body["id"] is not None
