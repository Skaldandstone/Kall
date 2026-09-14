"""The "help a friend" feature: a public, refreshable job digest generated
from either the owner's own CareerProfile or a lightweight set of criteria.

Every test here mocks out kall.services.shared_search.aggregate_job_search
(module-qualified -- monkeypatching job_search_aggregation.aggregate_job_search
directly would miss the already-bound name shared_search.py imported) so
nothing ever makes a real Serper call.
"""

import pytest
from kall.models import CareerProfile, SharedSearch
from kall.services import shared_search
from kall.services.shared_search import (
    MatchCriteria,
    criteria_from_dict,
    generate_digest,
    generate_slug,
    refresh_if_stale,
    resolve_criteria,
)
from sqlmodel import Session

API = "/api/me/shared-searches"

_FAKE_RESULTS = [
    {"title": "Senior QA Engineer", "url": "https://boards.greenhouse.io/acme/jobs/1", "snippet": "Automation testing role.", "provider": "Greenhouse", "domain": "boards.greenhouse.io"},
]


async def _fake_aggregate(queries: list[dict]) -> dict:
    return {"enabled": True, "results": _FAKE_RESULTS, "sites_searched": len(queries), "sites_failed": 0}


@pytest.fixture(autouse=True)
def _mock_search(monkeypatch) -> None:
    monkeypatch.setattr(shared_search, "aggregate_job_search", _fake_aggregate)


def test_criteria_from_dict_drops_unknown_keys_and_cleans_lists() -> None:
    criteria = criteria_from_dict(
        {"target_titles": [" QA Engineer ", "", "Director"], "unexpected": ["x"]},
        name="Jordan's search",
    )
    assert criteria.target_titles == ["QA Engineer", "Director"]
    assert criteria.countries == []
    assert criteria.name == "Jordan's search"


@pytest.mark.asyncio
async def test_generate_digest_scores_and_limits_results() -> None:
    criteria = MatchCriteria(name="test", target_titles=["QA Engineer"])
    digest = await generate_digest(criteria, limit=5)
    assert digest
    assert digest[0]["title"] == "Senior QA Engineer"
    assert digest[0]["score"] > 0


@pytest.mark.asyncio
async def test_generate_digest_excludes_out_of_scope_results() -> None:
    criteria = MatchCriteria(name="test", target_titles=["QA Engineer"], exclude_keywords=["automation testing"])
    digest = await generate_digest(criteria)
    assert digest == []


def test_resolve_criteria_reads_a_live_profile(engine) -> None:
    with Session(engine) as session:
        profile = CareerProfile(user_id=1, name="Jordan", target_titles=["QA Engineer"])
        session.add(profile)
        session.commit()
        session.refresh(profile)
        share = SharedSearch(owner_user_id=1, slug="abc123", source_profile_id=profile.id)
        criteria = resolve_criteria(session, share)
    assert criteria is not None
    assert criteria.target_titles == ["QA Engineer"]


def test_resolve_criteria_awaiting_input_has_none_yet(engine) -> None:
    with Session(engine) as session:
        share = SharedSearch(owner_user_id=1, slug="abc123", status="awaiting_input")
        assert resolve_criteria(session, share) is None


@pytest.mark.asyncio
async def test_refresh_if_stale_skips_a_recent_digest(engine) -> None:
    from kall.clock import utcnow

    with Session(engine) as session:
        share = SharedSearch(
            owner_user_id=1, slug="abc123",
            criteria={"target_titles": ["QA Engineer"]}, status="active",
            last_digest=[{"title": "stale"}], last_refreshed_at=utcnow(),
        )
        session.add(share)
        session.commit()
        session.refresh(share)

        refreshed = await refresh_if_stale(session, share)
        assert refreshed.last_digest == [{"title": "stale"}]

        forced = await refresh_if_stale(session, share, force=True)
        assert forced.last_digest[0]["title"] == "Senior QA Engineer"


def test_generate_slug_produces_unique_values(engine) -> None:
    with Session(engine) as session:
        a = generate_slug(session)
        session.add(SharedSearch(owner_user_id=1, slug=a))
        session.commit()
        b = generate_slug(session)
    assert a != b


def _profile(engine, user_id: int) -> int:
    with Session(engine) as session:
        profile = CareerProfile(user_id=user_id, name="Default", target_titles=["QA Engineer"])
        session.add(profile)
        session.commit()
        session.refresh(profile)
        return profile.id


def test_create_shared_search_from_own_profile_is_immediately_active(client, engine) -> None:
    profile_id = _profile(engine, client.user_id)
    response = client.post(API, json={"source_profile_id": profile_id})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "active"
    assert data["last_digest"]


def test_create_shared_search_with_ad_hoc_criteria(client) -> None:
    response = client.post(API, json={"criteria": {"target_titles": ["QA Engineer"]}, "friend_label": "Jordan"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "active"


def test_create_shared_search_as_invite_waits_for_the_friend(client) -> None:
    response = client.post(API, json={"mode": "invite", "friend_label": "Jordan"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "awaiting_input"
    assert data["last_digest"] is None


def test_create_shared_search_requires_one_real_source(client) -> None:
    response = client.post(API, json={})
    assert response.status_code == 422


def test_create_shared_search_rejects_someone_elses_profile(client, engine) -> None:
    other_profile_id = _profile(engine, client.user_id + 1)
    response = client.post(API, json={"source_profile_id": other_profile_id})
    assert response.status_code == 404


def test_list_and_revoke_shared_search(client) -> None:
    created = client.post(API, json={"criteria": {"target_titles": ["QA Engineer"]}}).json()

    listed = client.get(API)
    assert listed.status_code == 200
    assert any(item["id"] == created["id"] for item in listed.json())

    revoked = client.delete(f"{API}/{created['id']}")
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"

    listed_again = client.get(API)
    assert next(item for item in listed_again.json() if item["id"] == created["id"])["status"] == "revoked"


def test_revoking_someone_elses_share_404s(client, engine) -> None:
    with Session(engine) as session:
        other = SharedSearch(owner_user_id=client.user_id + 1, slug="not-yours", criteria={"target_titles": []})
        session.add(other)
        session.commit()
        session.refresh(other)
        other_id = other.id
    response = client.delete(f"{API}/{other_id}")
    assert response.status_code == 404


def test_public_digest_404s_on_a_missing_slug(client) -> None:
    assert client.get("/api/shared-searches/does-not-exist").status_code == 404


def test_public_digest_404s_on_a_revoked_share(client) -> None:
    created = client.post(API, json={"criteria": {"target_titles": ["QA Engineer"]}}).json()
    client.delete(f"{API}/{created['id']}")
    response = client.get(f"/api/shared-searches/{created['slug']}")
    assert response.status_code == 404


def test_public_digest_shows_the_intake_form_while_awaiting_input(client) -> None:
    created = client.post(API, json={"mode": "invite"}).json()
    response = client.get(f"/api/shared-searches/{created['slug']}")
    assert response.status_code == 200
    assert response.json() == {"status": "awaiting_input"}


def test_public_digest_returns_results_once_active(client) -> None:
    created = client.post(API, json={"criteria": {"target_titles": ["QA Engineer"]}}).json()
    response = client.get(f"/api/shared-searches/{created['slug']}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "active"
    assert data["results"]


def test_submitting_criteria_activates_an_invite_and_generates_a_digest(client) -> None:
    created = client.post(API, json={"mode": "invite"}).json()
    response = client.post(
        f"/api/shared-searches/{created['slug']}/criteria",
        json={"criteria": {"target_titles": ["QA Engineer"]}},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "active"
    assert data["results"]


def test_submitting_criteria_twice_is_refused_once_active(client) -> None:
    created = client.post(API, json={"mode": "invite"}).json()
    client.post(f"/api/shared-searches/{created['slug']}/criteria", json={"criteria": {"target_titles": ["QA Engineer"]}})
    second = client.post(f"/api/shared-searches/{created['slug']}/criteria", json={"criteria": {"target_titles": ["Director"]}})
    assert second.status_code == 404


def test_refresh_endpoint_forces_a_recompute(client) -> None:
    created = client.post(API, json={"criteria": {"target_titles": ["QA Engineer"]}}).json()
    response = client.post(f"/api/shared-searches/{created['slug']}/refresh")
    assert response.status_code == 200
    assert response.json()["results"]


def test_refresh_endpoint_404s_on_a_still_pending_invite(client) -> None:
    created = client.post(API, json={"mode": "invite"}).json()
    response = client.post(f"/api/shared-searches/{created['slug']}/refresh")
    assert response.status_code == 404


def test_a_user_cannot_exceed_the_active_share_cap(client) -> None:
    from kall.api_shared_search import MAX_ACTIVE_SHARES_PER_USER

    for _ in range(MAX_ACTIVE_SHARES_PER_USER):
        response = client.post(API, json={"criteria": {"target_titles": ["QA Engineer"]}})
        assert response.status_code == 200
    over_limit = client.post(API, json={"criteria": {"target_titles": ["QA Engineer"]}})
    assert over_limit.status_code == 422
