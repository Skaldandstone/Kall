from kall.models import Application, CareerProfile, Job, JobMatch, Opportunity
from kall.models.enums import ApplicationStatus
from kall.services.applications import find_existing_application
from sqlmodel import select


def _seed(session, user_id: int):
    profile = CareerProfile(user_id=user_id, name="QA")
    session.add(profile)
    session.commit()
    session.refresh(profile)
    job = Job(source="greenhouse", company="Acme", title="QA Lead", description="Lead QA", url="https://boards.greenhouse.io/acme/jobs/42")
    session.add(job)
    session.commit()
    session.refresh(job)
    return profile, job


def test_the_same_link_with_a_query_string_finds_the_existing_application(client) -> None:
    from kall.db import get_session
    from kall.main import app

    session = next(app.dependency_overrides[get_session]())
    me = client.get("/api/me").json()
    profile, job = _seed(session, me["id"])
    session.add(Application(user_id=me["id"], job_id=job.id, career_profile_id=profile.id, status=ApplicationStatus.REVIEW_REQUIRED))
    session.commit()

    found = find_existing_application(session, me["id"], url="https://boards.greenhouse.io/acme/jobs/42?gh_jid=42&utm=x")
    assert found is not None and found.job_id == job.id

    check = client.get("/api/me/applications/existing", params={"url": "https://boards.greenhouse.io/acme/jobs/42?gh_jid=42"})
    body = check.json()
    assert body["exists"] is True
    assert body["application"]["stage"] == "review"
    assert body["application"]["completed"] is False
    assert body["application"]["company"] == "Acme"

    assert client.get("/api/me/applications/existing", params={"url": "https://example.com/other"}).json()["exists"] is False
    assert client.get("/api/me/applications/existing").status_code == 422


def test_preparing_again_returns_the_same_application_not_a_second_row(client) -> None:
    from kall.db import get_session
    from kall.main import app

    session = next(app.dependency_overrides[get_session]())
    me = client.get("/api/me").json()
    profile, job = _seed(session, me["id"])
    body = {"job_id": job.id, "professional_profile_id": profile.id, "resume_id": None, "customize_resume": False, "generate_cover_letter": False, "application_mode": "assisted"}
    first = client.post("/api/applications/prepare-options", json=body)
    assert first.status_code == 200, first.text
    second = client.post("/api/applications/prepare-options", json=body)
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert len(session.exec(select(Application).where(Application.user_id == me["id"])).all()) == 1


def test_tracking_an_in_progress_application_as_applied_asks_first(client) -> None:
    from kall.db import get_session
    from kall.main import app

    session = next(app.dependency_overrides[get_session]())
    me = client.get("/api/me").json()
    profile, job = _seed(session, me["id"])
    session.add(Application(user_id=me["id"], job_id=job.id, career_profile_id=profile.id, status=ApplicationStatus.REVIEW_REQUIRED))
    session.commit()

    payload = {"url": job.url, "title": job.title, "source": "test", "professional_profile_id": profile.id}
    refused = client.post("/api/applications/track-external", json=payload)
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "application_in_progress"
    assert refused.json()["detail"]["application"]["stage"] == "review"

    forced = client.post("/api/applications/track-external", json={**payload, "mark_submitted_anyway": True})
    assert forced.status_code == 200, forced.text
    assert forced.json()["status"] == "submitted"
    assert len(session.exec(select(Application).where(Application.user_id == me["id"])).all()) == 1


def test_a_fully_submitted_application_no_longer_shows_in_the_feed_or_inbox(client) -> None:
    """A job already submitted has nothing left to decide -- surfacing it
    again in search results or the tracked inbox just invites a second,
    redundant application for the same listing."""
    from kall.db import get_session
    from kall.main import app

    session = next(app.dependency_overrides[get_session]())
    me = client.get("/api/me").json()
    profile, job = _seed(session, me["id"])
    session.add(JobMatch(user_id=me["id"], career_profile_id=profile.id, job_id=job.id, score=80, recommendation="apply"))
    session.add(Opportunity(
        user_id=me["id"], professional_profile_id=profile.id, job_id=job.id,
        canonical_key=f"job:{job.id}", material_fingerprint="test", match_score=80,
    ))
    session.add(Application(user_id=me["id"], job_id=job.id, career_profile_id=profile.id, status=ApplicationStatus.SUBMITTED))
    session.commit()

    feed = client.get(f"/api/jobs/feed?professional_profile_id={profile.id}")
    assert feed.json() == []
    inbox = client.get("/api/opportunities")
    assert inbox.json() == []


def test_an_in_progress_application_still_shows_but_offers_to_continue_it(client) -> None:
    """An application still being worked on should not be hidden -- but the
    feed should say so, so the UI can offer "continue" instead of "prepare a
    new one" for the exact same listing."""
    from kall.db import get_session
    from kall.main import app

    session = next(app.dependency_overrides[get_session]())
    me = client.get("/api/me").json()
    profile, job = _seed(session, me["id"])
    session.add(JobMatch(user_id=me["id"], career_profile_id=profile.id, job_id=job.id, score=80, recommendation="apply"))
    session.add(Application(user_id=me["id"], job_id=job.id, career_profile_id=profile.id, status=ApplicationStatus.REVIEW_REQUIRED))
    session.commit()

    feed = client.get(f"/api/jobs/feed?professional_profile_id={profile.id}").json()
    assert len(feed) == 1
    assert feed[0]["existing_application"] is not None
    assert feed[0]["existing_application"]["stage"] == "review"
    assert feed[0]["existing_application"]["completed"] is False
