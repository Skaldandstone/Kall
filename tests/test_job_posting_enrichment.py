"""Importing a job with no real snippet (a bare Google search result, or a
"record it as applied elsewhere" click with nothing typed in) used to leave
description as a fixed placeholder forever. A BackgroundTasks callback now
tries to upgrade it from the posting's own schema.org JobPosting data after
the response is already sent -- see api_search_apply.py's _enrich_job_description.

conftest.py's _no_real_job_posting_fetches autouse fixture stops every test
from making a real outbound request by default; each test here overrides it
back to prove the wiring itself, using MockTransport so nothing leaves the
process.
"""

from kall.models import CareerProfile, Job
from kall.services import job_posting_schema
from sqlmodel import Session, select

API = "/api/applications/track-external"


def _profile(engine, user_id: int) -> int:
    with Session(engine) as session:
        profile = CareerProfile(user_id=user_id, name="Default", target_titles=["Retail Associate"])
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return profile.id


def test_a_job_with_no_snippet_is_enriched_from_its_own_page(client, engine, monkeypatch) -> None:
    monkeypatch.setattr(job_posting_schema, "fetch_job_posting_description", lambda url, **kwargs: "Real description from the posting's own page.")
    profile_id = _profile(engine, client.user_id)

    response = client.post(API, json={
        "url": "https://example.com/jobs/1", "title": "Retail Associate",
        "source": "google_cse", "professional_profile_id": profile_id,
    })
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.url == "https://example.com/jobs/1")).one()
        assert job.description == "Real description from the posting's own page."


def test_a_job_with_a_real_snippet_is_never_overwritten(client, engine, monkeypatch) -> None:
    """The enrichment must only ever upgrade the generic placeholder -- a
    real snippet someone already supplied is never replaced, no matter what
    the page fetch would have returned."""
    monkeypatch.setattr(job_posting_schema, "fetch_job_posting_description", lambda url, **kwargs: "This must never appear.")
    profile_id = _profile(engine, client.user_id)

    response = client.post(API, json={
        "url": "https://example.com/jobs/2", "title": "Retail Associate",
        "snippet": "A real snippet from the search result itself.",
        "source": "google_cse", "professional_profile_id": profile_id,
    })
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.url == "https://example.com/jobs/2")).one()
        assert job.description == "A real snippet from the search result itself."


def test_a_failed_fetch_leaves_the_placeholder_in_place(client, engine, monkeypatch) -> None:
    monkeypatch.setattr(job_posting_schema, "fetch_job_posting_description", lambda url, **kwargs: None)
    profile_id = _profile(engine, client.user_id)

    response = client.post(API, json={
        "url": "https://example.com/jobs/3", "title": "Retail Associate",
        "source": "google_cse", "professional_profile_id": profile_id,
    })
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.url == "https://example.com/jobs/3")).one()
        assert "Open the original posting" in job.description


def test_no_test_makes_a_real_outbound_request_by_default(client, engine) -> None:
    """The autouse fixture itself: without overriding it, importing a job
    with no snippet must not attempt any real network call."""
    profile_id = _profile(engine, client.user_id)
    response = client.post(API, json={
        "url": "https://example.com/jobs/4", "title": "Retail Associate",
        "source": "google_cse", "professional_profile_id": profile_id,
    })
    assert response.status_code == 200, response.text
    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.url == "https://example.com/jobs/4")).one()
        assert "Open the original posting" in job.description
