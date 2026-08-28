"""POST /jobs/capture: the extension's "save any job from any site" path.

Kall's own discovery only ever knew how to search three ATS providers
(Greenhouse/Lever/Ashby) plus a Google/Bing query builder -- nothing let
someone browsing LinkedIn, Indeed, or a random company careers page save
what they were looking at into the tracked opportunity inbox. Storage and
matching already existed (Job, deterministic_match, upsert_opportunity);
this is the missing capture path.
"""

from kall.models import CareerProfile, Opportunity
from sqlmodel import Session, select

API = "/api/jobs/capture"


def _profile(engine, user_id: int, **overrides) -> int:
    defaults = dict(user_id=user_id, name="Default", target_titles=["Environment Artist"])
    defaults.update(overrides)
    with Session(engine) as session:
        profile = CareerProfile(**defaults)
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return profile.id


def test_capturing_a_job_creates_a_tracked_opportunity(client, engine) -> None:
    profile_id = _profile(engine, client.user_id)
    response = client.post(API, json={
        "url": "https://www.linkedin.com/jobs/view/1234567890",
        "title": "Environment Artist",
        "company": "Acme Games",
        "location": "Remote",
        "description": "Build worlds with Unreal Engine.",
        "professional_profile_id": profile_id,
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "new"
    assert body["match_score"] > 0

    with Session(engine) as session:
        opportunities = list(session.exec(select(Opportunity).where(Opportunity.user_id == client.user_id)))
        assert len(opportunities) == 1


def test_capturing_the_same_url_twice_does_not_duplicate(client, engine) -> None:
    profile_id = _profile(engine, client.user_id)
    payload = {
        "url": "https://www.indeed.com/viewjob?jk=abc123",
        "title": "Environment Artist",
        "company": "Acme Games",
        "professional_profile_id": profile_id,
    }
    first = client.post(API, json=payload)
    second = client.post(API, json=payload)
    assert first.status_code == 200 and second.status_code == 200

    with Session(engine) as session:
        opportunities = list(session.exec(select(Opportunity).where(Opportunity.user_id == client.user_id)))
        assert len(opportunities) == 1


def test_capturing_a_job_for_someone_elses_profile_is_rejected(client, engine) -> None:
    other_profile_id = _profile(engine, client.user_id + 1)
    response = client.post(API, json={
        "url": "https://example.com/jobs/1",
        "title": "Engineer",
        "professional_profile_id": other_profile_id,
    })
    assert response.status_code == 404


def test_captured_job_fills_in_company_and_location_from_the_page(client, engine) -> None:
    profile_id = _profile(engine, client.user_id)
    client.post(API, json={
        "url": "https://boards.greenhouse.io/acme/jobs/99",
        "title": "Environment Artist",
        "company": "Real Company Name",
        "location": "Austin, TX",
        "professional_profile_id": profile_id,
    })

    from kall.models import Job

    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.url == "https://boards.greenhouse.io/acme/jobs/99")).first()
        assert job.company == "Real Company Name"
        assert job.location == "Austin, TX"
