"""Flagging a job posting as dead should stop it coming back."""

import pytest
from kall.models import CareerProfile, SearchSource, User
from kall.providers.jobs import DiscoveredJob
from kall.services.discovery import run_discovery
from kall.services.suppression import normalize_url
from sqlmodel import Session

API = "/api/search/suppressed"


def test_normalize_url_collapses_incidental_differences() -> None:
    assert normalize_url("HTTPS://Boards.Greenhouse.IO/acme/jobs/42#apply") == (
        "https://boards.greenhouse.io/acme/jobs/42"
    )


def test_normalize_url_keeps_the_query_that_identifies_the_posting() -> None:
    # Greenhouse and Lever both put the posting id in the query string --
    # dropping it would suppress an entire board from one dead link.
    assert normalize_url("https://example.com/jobs?gh_jid=7") == "https://example.com/jobs?gh_jid=7"


def test_flagging_a_result_hides_it_and_survives_a_fresh_request(client) -> None:
    url = "https://boards.example.com/jobs/123"
    created = client.post(API, json={"url": url, "title": "Dead role", "reason": "dead_link"})
    assert created.status_code == 200, created.text

    listed = client.get(API)
    assert listed.status_code == 200
    assert [row["url"] for row in listed.json()] == [url]
    assert listed.json()[0]["reason"] == "dead_link"


def test_flagging_the_same_url_twice_upgrades_rather_than_duplicates(client) -> None:
    url = "https://boards.example.com/jobs/123"
    client.post(API, json={"url": url, "reason": "applied_external", "title": "Role"})
    client.post(API, json={"url": url, "reason": "dead_link"})

    rows = client.get(API).json()
    assert len(rows) == 1
    assert rows[0]["reason"] == "dead_link"
    # The title from the first flag is not lost by a later one that omits it.
    assert rows[0]["title"] == "Role"


def test_differently_written_urls_are_treated_as_one_posting(client) -> None:
    client.post(API, json={"url": "https://Boards.Example.com/jobs/1#apply"})
    client.post(API, json={"url": "https://boards.example.com/jobs/1"})
    assert len(client.get(API).json()) == 1


def test_an_unsupported_reason_is_rejected(client) -> None:
    response = client.post(API, json={"url": "https://a.example.com/1", "reason": "because"})
    assert response.status_code == 422


def test_restoring_removes_the_suppression(client) -> None:
    url = "https://boards.example.com/jobs/9"
    client.post(API, json={"url": url})
    client.request("DELETE", API, json={"url": url})
    assert client.get(API).json() == []


def test_restore_all_clears_every_suppression(client) -> None:
    client.post(API, json={"url": "https://a.example.com/1"})
    client.post(API, json={"url": "https://b.example.com/2"})
    response = client.delete(f"{API}/all")
    assert response.json() == {"restored": 2}
    assert client.get(API).json() == []


class _StubProvider:
    """Returns one posting, the way a real ATS provider would.

    The URL carries a query string on purpose: normalize_discovered() strips it
    before storing the Job, which is exactly the mismatch a suppression flagged
    from the Google search workspace has to survive.
    """

    async def collect(self, company: str, board_key: str):
        del company, board_key
        return [
            DiscoveredJob(
                source="greenhouse",
                external_id="abc",
                company="Acme",
                title="Staff Engineer",
                description="Build things.",
                url="https://boards.example.com/acme/jobs/1?gh_jid=1",
                location="Remote",
            )
        ]


@pytest.mark.anyio
async def test_a_dead_link_never_returns_to_the_opportunity_inbox(
    client, engine, monkeypatch
) -> None:
    """The point of the feature: a flagged posting stays out of future runs."""
    from kall.services import discovery

    monkeypatch.setitem(discovery.PROVIDERS, "greenhouse", _StubProvider)
    dead_url = "https://boards.example.com/acme/jobs/1?gh_jid=1"

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        profile = CareerProfile(user_id=user.id, name="Engineer")
        session.add(profile)
        session.add(
            SearchSource(
                user_id=user.id, provider="greenhouse", company_name="Acme", board_key="acme"
            )
        )
        session.commit()
        session.refresh(profile)
        profile_id = profile.id

    # Before flagging, discovery imports the posting.
    with Session(engine) as session:
        run = await run_discovery(
            session, session.get(User, client.user_id), session.get(CareerProfile, profile_id)
        )
        assert run.jobs_created == 1
        assert run.jobs_skipped == 0
        assert run.errors == []

    client.post(API, json={"url": dead_url, "reason": "dead_link"})

    # After flagging, the same posting is skipped rather than re-ingested, and
    # the run is still a clean success -- a skip is not an error.
    with Session(engine) as session:
        run = await run_discovery(
            session, session.get(User, client.user_id), session.get(CareerProfile, profile_id)
        )
        assert run.jobs_skipped == 1
        assert run.jobs_created == 0
        assert run.status == "completed"
        assert run.errors == []


@pytest.mark.anyio
async def test_flagging_a_posting_dead_after_it_was_already_matched_removes_it_from_the_feed_and_inbox(
    client, engine, monkeypatch
) -> None:
    """dead_link suppression only ever blocked future ingestion (see
    test_a_dead_link_never_returns_to_the_opportunity_inbox above) -- it did
    nothing for a JobMatch/Opportunity a previous run had already created.
    A user telling Kall "this posting is dead" must remove it from the feed
    and inbox they're already looking at, not just stop it reappearing.
    """
    from kall.services import discovery

    monkeypatch.setitem(discovery.PROVIDERS, "greenhouse", _StubProvider)
    dead_url = "https://boards.example.com/acme/jobs/1?gh_jid=1"

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        profile = CareerProfile(user_id=user.id, name="Engineer")
        session.add(profile)
        session.add(
            SearchSource(user_id=user.id, provider="greenhouse", company_name="Acme", board_key="acme")
        )
        session.commit()
        session.refresh(profile)
        profile_id = profile.id

    with Session(engine) as session:
        await run_discovery(session, session.get(User, client.user_id), session.get(CareerProfile, profile_id))

    feed_before = client.get(f"/api/jobs/feed?professional_profile_id={profile_id}")
    assert len(feed_before.json()) == 1
    inbox_before = client.get("/api/opportunities")
    assert len(inbox_before.json()) == 1

    client.post(API, json={"url": dead_url, "reason": "dead_link"})

    feed_after = client.get(f"/api/jobs/feed?professional_profile_id={profile_id}")
    assert feed_after.json() == []
    inbox_after = client.get("/api/opportunities")
    assert inbox_after.json() == []


@pytest.mark.anyio
async def test_not_relevant_blocks_discovery_the_same_way_dead_link_does(client, engine, monkeypatch) -> None:
    """A posting from the wrong category entirely (Mechanical Engineering QA
    surfacing under a Software Engineering search) should stop coming back
    even with the same industry/profile filters applied -- not just get
    dismissed once. "not_relevant" is a discovery-blocking reason exactly
    like "dead_link", not merely a lighter-touch hide."""
    from kall.services import discovery

    monkeypatch.setitem(discovery.PROVIDERS, "greenhouse", _StubProvider)
    url = "https://boards.example.com/acme/jobs/1?gh_jid=1"

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        profile = CareerProfile(user_id=user.id, name="Engineer")
        session.add(profile)
        session.add(SearchSource(user_id=user.id, provider="greenhouse", company_name="Acme", board_key="acme"))
        session.commit()
        session.refresh(profile)
        profile_id = profile.id

    with Session(engine) as session:
        await run_discovery(session, session.get(User, client.user_id), session.get(CareerProfile, profile_id))

    client.post(API, json={"url": url, "reason": "not_relevant"})

    feed_after = client.get(f"/api/jobs/feed?professional_profile_id={profile_id}")
    assert feed_after.json() == []
    inbox_after = client.get("/api/opportunities")
    assert inbox_after.json() == []

    with Session(engine) as session:
        run = await run_discovery(session, session.get(User, client.user_id), session.get(CareerProfile, profile_id))
        assert run.jobs_skipped == 1
        assert run.jobs_created == 0


@pytest.mark.anyio
async def test_hidden_removes_from_view_without_blocking_future_discovery(client, engine, monkeypatch) -> None:
    """"Hide" is the lighter-touch action: it removes the posting from the
    feed and inbox the person is looking at right now, but -- unlike
    "not_relevant" or "dead_link" -- does not claim the posting is wrong or
    broken, so discovery may keep refreshing it in the background."""
    from kall.services import discovery

    monkeypatch.setitem(discovery.PROVIDERS, "greenhouse", _StubProvider)
    url = "https://boards.example.com/acme/jobs/1?gh_jid=1"

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        profile = CareerProfile(user_id=user.id, name="Engineer")
        session.add(profile)
        session.add(SearchSource(user_id=user.id, provider="greenhouse", company_name="Acme", board_key="acme"))
        session.commit()
        session.refresh(profile)
        profile_id = profile.id

    with Session(engine) as session:
        await run_discovery(session, session.get(User, client.user_id), session.get(CareerProfile, profile_id))

    client.post(API, json={"url": url, "reason": "hidden"})

    feed_after = client.get(f"/api/jobs/feed?professional_profile_id={profile_id}")
    assert feed_after.json() == []
    inbox_after = client.get("/api/opportunities")
    assert inbox_after.json() == []

    with Session(engine) as session:
        run = await run_discovery(session, session.get(User, client.user_id), session.get(CareerProfile, profile_id))
        assert run.jobs_skipped == 0
        assert run.jobs_created == 0  # already exists as a Job row -- just refreshed, not recreated


@pytest.mark.anyio
async def test_an_applied_flag_does_not_block_discovery(client, engine, monkeypatch) -> None:
    """Only dead links are withheld -- an application in flight must stay visible."""
    from kall.services import discovery

    monkeypatch.setitem(discovery.PROVIDERS, "greenhouse", _StubProvider)

    with Session(engine) as session:
        user = session.get(User, client.user_id)
        profile = CareerProfile(user_id=user.id, name="Engineer")
        session.add(profile)
        session.add(
            SearchSource(
                user_id=user.id, provider="greenhouse", company_name="Acme", board_key="acme"
            )
        )
        session.commit()
        session.refresh(profile)
        profile_id = profile.id

    client.post(
        API,
        json={"url": "https://boards.example.com/acme/jobs/1?gh_jid=1", "reason": "applied_external"},
    )

    with Session(engine) as session:
        run = await run_discovery(
            session, session.get(User, client.user_id), session.get(CareerProfile, profile_id)
        )
        assert run.jobs_skipped == 0
        assert run.jobs_created == 1
        assert run.errors == []
