"""SecurityClearance was fully wired on the backend (registered in
profile_api.py's generic RESOURCE_MODELS CRUD) but recordSchema.ts had no
"clearances" section at all -- the entire feature was unreachable from the
UI, the same "backend wired, no UI" gap found for Contact before it was
built.
"""

API = "/api/profile/resources/clearances"


def test_creating_and_listing_a_clearance(client) -> None:
    created = client.post(API, json={"data": {
        "clearance_type": "Top Secret", "country": "United States", "status": "active",
        "granted_on": "2020-01-01", "expires_on": "2030-01-01",
    }})
    assert created.status_code == 200, created.text
    assert created.json()["clearance_type"] == "Top Secret"

    listed = client.get(API)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["status"] == "active"


def test_updating_a_clearances_status(client) -> None:
    created = client.post(API, json={"data": {
        "clearance_type": "Secret", "country": "United States", "status": "active",
    }})
    clearance_id = created.json()["id"]

    patched = client.patch(f"{API}/{clearance_id}", json={"data": {"status": "expired"}})
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "expired"


def test_deleting_a_clearance(client) -> None:
    created = client.post(API, json={"data": {
        "clearance_type": "Secret", "country": "United States", "status": "active",
    }})
    clearance_id = created.json()["id"]

    deleted = client.delete(f"{API}/{clearance_id}")
    assert deleted.status_code == 204
    assert client.get(API).json() == []
