"""Contact: networking notes, riding the existing generic profile-resource
CRUD (profile_api.py's RESOURCE_MODELS) rather than a bespoke endpoint.

The field names deliberately avoid "email"/"notes" -- SENSITIVE_KEYS in
profile_api.py silently redirects those exact names to an "_encrypted"
column, which Contact does not have, so a plain "email"/"notes" field
would have looked like it saved and then silently lost its value.
"""

API = "/api/profile/resources/contacts"


def test_creating_and_listing_a_contact(client) -> None:
    created = client.post(API, json={"data": {
        "name": "Jamie Rivera",
        "company": "Acme Games",
        "title": "Technical Recruiter",
        "relationship": "recruiter",
        "contact_email": "jamie@acmegames.example",
        "linkedin_url": "https://linkedin.com/in/jamierivera",
        "contact_notes": "Met at GDC 2026, said to reach out once the studio opens req.",
    }})
    assert created.status_code == 200, created.text
    assert created.json()["name"] == "Jamie Rivera"
    assert created.json()["contact_email"] == "jamie@acmegames.example"

    listed = client.get(API)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["contact_notes"].startswith("Met at GDC")


def test_a_contact_needs_only_a_name(client) -> None:
    response = client.post(API, json={"data": {"name": "Alex Chen"}})
    assert response.status_code == 200, response.text
    assert response.json()["company"] is None


def test_updating_a_contacts_follow_up_date(client) -> None:
    created = client.post(API, json={"data": {"name": "Jamie Rivera"}})
    contact_id = created.json()["id"]

    patched = client.patch(f"{API}/{contact_id}", json={"data": {
        "last_contacted_on": "2026-08-01",
        "follow_up_on": "2026-09-01",
    }})
    assert patched.status_code == 200, patched.text
    assert patched.json()["follow_up_on"] == "2026-09-01"


def test_deleting_a_contact(client) -> None:
    created = client.post(API, json={"data": {"name": "Jamie Rivera"}})
    contact_id = created.json()["id"]

    deleted = client.delete(f"{API}/{contact_id}")
    assert deleted.status_code == 204
    assert client.get(API).json() == []


def test_a_contact_belongs_to_the_account_that_created_it(client, engine) -> None:
    from kall.models import Contact, User
    from sqlmodel import Session

    with Session(engine) as session:
        other = User(clerk_user_id="user_other_networker", email="other@example.com", full_name="Other")
        session.add(other)
        session.commit()
        session.refresh(other)
        session.add(Contact(user_id=other.id, name="Not Yours"))
        session.commit()

    listed = client.get(API)
    assert listed.json() == []


def test_email_is_not_silently_dropped_by_the_sensitive_key_redirect(client) -> None:
    """Regression guard: SENSITIVE_KEYS maps a plain "email" field to
    "email_encrypted" for other resources. Contact's field is named
    contact_email specifically to avoid that collision -- if it were ever
    renamed back to "email", this would start failing because the value
    would vanish rather than error."""
    created = client.post(API, json={"data": {"name": "Jamie Rivera", "contact_email": "jamie@example.com"}})
    assert created.json()["contact_email"] == "jamie@example.com"
