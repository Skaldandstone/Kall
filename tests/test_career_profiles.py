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
