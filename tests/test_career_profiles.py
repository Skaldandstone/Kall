"""CareerProfile.equity_preference was defined on the model but missing
from CareerProfileUpdate entirely -- the field could never actually be set
through the API, the same "field exists nowhere in the write path" gap
found repeatedly elsewhere in this codebase.
"""


def _create_profile(client) -> int:
    response = client.post("/api/me/professional-profiles", json={"name": "Test Profile"})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_equity_preference_can_be_set_and_reads_back(client) -> None:
    profile_id = _create_profile(client)
    updated = client.put(f"/api/me/career-profiles/{profile_id}", json={
        "name": "Test Profile",
        "equity_preference": "required",
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["equity_preference"] == "required"

    listed = client.get("/api/me/career-profiles")
    row = next(row for row in listed.json()["profiles"] if row["id"] == profile_id)
    assert row["equity_preference"] == "required"


def test_equity_preference_defaults_to_unset(client) -> None:
    profile_id = _create_profile(client)
    listed = client.get("/api/me/career-profiles")
    row = next(row for row in listed.json()["profiles"] if row["id"] == profile_id)
    assert row["equity_preference"] is None


def test_employment_types_minimum_total_comp_and_bonus_percent_are_editable(client) -> None:
    """The same gap as equity_preference, for three more fields:
    employment_types and target_bonus_percent were unreachable by any
    endpoint after creation, and minimum_total_comp could be set once at
    onboarding but never edited or even shown afterward."""
    profile_id = _create_profile(client)
    updated = client.put(f"/api/me/career-profiles/{profile_id}", json={
        "name": "Test Profile",
        "employment_types": ["contract", "part_time"],
        "minimum_total_comp": 150000,
        "target_bonus_percent": 12.5,
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["employment_types"] == ["contract", "part_time"]
    assert updated.json()["minimum_total_comp"] == 150000
    assert updated.json()["target_bonus_percent"] == 12.5

    listed = client.get("/api/me/career-profiles")
    row = next(row for row in listed.json()["profiles"] if row["id"] == profile_id)
    assert row["employment_types"] == ["contract", "part_time"]
    assert row["minimum_total_comp"] == 150000
    assert row["target_bonus_percent"] == 12.5


def test_pausing_a_profile_does_not_wipe_equity_or_the_new_fields(client) -> None:
    """setActive() (StrategyTab.tsx) resends the whole profile through the
    same full-replace PUT the edit form uses. It was missing
    equity_preference already -- silently wiping it back to null on every
    pause/reactivate -- and would have missed these three fields too."""
    profile_id = _create_profile(client)
    client.put(f"/api/me/career-profiles/{profile_id}", json={
        "name": "Test Profile",
        "equity_preference": "required",
        "employment_types": ["contract"],
        "minimum_total_comp": 150000,
        "target_bonus_percent": 12.5,
    })

    paused = client.put(f"/api/me/career-profiles/{profile_id}", json={
        "name": "Test Profile",
        "equity_preference": "required",
        "employment_types": ["contract"],
        "minimum_total_comp": 150000,
        "target_bonus_percent": 12.5,
        "is_active": False,
    })
    assert paused.status_code == 200
    assert paused.json()["equity_preference"] == "required"
    assert paused.json()["employment_types"] == ["contract"]
    assert paused.json()["minimum_total_comp"] == 150000
    assert paused.json()["target_bonus_percent"] == 12.5
    assert paused.json()["is_active"] is False


def test_targeting_survives_unrelated_updates_pause_and_reactivation(client) -> None:
    created = client.post("/api/me/professional-profiles", json={
        "name": "Quality", "functional_areas": ["Quality Engineering"],
        "exclude_keywords": ["unpaid", "manual tester"], "minimum_base": 0,
    })
    assert created.status_code == 200
    profile_id = created.json()["id"]
    for active in [False, True]:
        updated = client.put(f"/api/me/career-profiles/{profile_id}", json={
            "name": "Quality", "is_active": active, "travel_max_percent": 0, "target_bonus_percent": 0,
        })
        assert updated.status_code == 200
        row = updated.json()
        assert row["functional_areas"] == ["Quality Engineering"]
        assert row["exclude_keywords"] == ["unpaid", "manual tester"]
        assert row["minimum_base"] == row["travel_max_percent"] == row["target_bonus_percent"] == 0
        assert row["is_active"] is active
    listed = client.get("/api/me/career-profiles").json()["profiles"][0]
    assert listed["functional_areas"] == ["Quality Engineering"]
    assert listed["exclude_keywords"] == ["unpaid", "manual tester"]


def test_explicitly_clearing_an_area_or_exclusion_still_works(client):
    profile_id = client.post("/api/me/professional-profiles", json={
        "name": "Quality", "functional_areas": ["Quality Engineering"], "exclude_keywords": ["unpaid"],
    }).json()["id"]
    cleared = client.put(f"/api/me/career-profiles/{profile_id}", json={
        "name": "Quality", "functional_areas": [], "exclude_keywords": [],
    })
    assert cleared.json()["functional_areas"] == []
    assert cleared.json()["exclude_keywords"] == []


def test_functional_area_catalog_exposes_the_matching_vocabulary(client):
    response = client.get("/api/me/career-profiles/functional-areas")
    assert response.status_code == 200
    area = next(area for area in response.json()["areas"] if area["name"] == "Quality Engineering")
    assert "SDET" in area["related_roles"]
