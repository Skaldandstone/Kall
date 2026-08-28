"""POST /api/jobs must require an authenticated caller.

Regression: create_job was the one mutating endpoint in kall.api that omitted
the get_current_user dependency every sibling route carries, so any anonymous
caller could insert rows into the shared Job catalog. Job has no user_id (it's
a shared catalog matched per-user via JobMatch), so the fix is authentication,
not ownership scoping -- these tests pin both halves of that.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from kall.auth import get_current_user
from kall.db import get_session
from kall.main import app
from kall.models import Job
from sqlmodel import Session, select

VALID_PAYLOAD = {
    "source": "manual",
    "company": "Acme",
    "title": "Staff Engineer",
    "description": "Build things.",
    "url": "https://example.com/jobs/1",
}


@pytest.fixture
def anon_client(engine) -> Iterator[TestClient]:
    """A TestClient with the DB stubbed but identity NOT overridden, so the real
    get_current_user runs and rejects an unauthenticated request. (The shared
    `client` fixture overrides get_current_user and is always signed in, which
    is exactly what we must NOT do here.)"""

    def override_get_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_session, None)


def test_create_job_rejects_anonymous_callers(anon_client: TestClient, engine) -> None:
    resp = anon_client.post("/api/jobs", json=VALID_PAYLOAD)

    assert resp.status_code == 401
    # And nothing was written to the shared catalog.
    with Session(engine) as session:
        assert session.exec(select(Job)).all() == []


def test_authenticated_user_can_still_create_a_job(client: TestClient, engine) -> None:
    resp = client.post("/api/jobs", json=VALID_PAYLOAD)

    assert resp.status_code == 200
    body = resp.json()
    assert body["company"] == "Acme"
    assert body["title"] == "Staff Engineer"
    with Session(engine) as session:
        assert len(session.exec(select(Job)).all()) == 1
