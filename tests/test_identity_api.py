from kall.models import CandidateProfile
from sqlmodel import Session, select


def test_partial_identity_update_preserves_omitted_sensitive_fields(client, engine) -> None:
    with Session(engine) as session:
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.user_id == client.user_id)).one()
        profile.phone_encrypted = "preserve-phone"
        profile.address_encrypted = "preserve-address"
        profile.postal_code_encrypted = "preserve-postal"
        session.add(profile)
        session.commit()

    response = client.put("/api/me/identity", json={"preferred_name": "Ada", "city": "Seattle"})

    assert response.status_code == 200
    assert response.json()["preferred_name"] == "Ada"
    assert response.json()["city"] == "Seattle"
    assert "phone_encrypted" not in response.json()
    with Session(engine) as session:
        profile = session.exec(select(CandidateProfile).where(CandidateProfile.user_id == client.user_id)).one()
        assert profile.phone_encrypted == "preserve-phone"
        assert profile.address_encrypted == "preserve-address"
        assert profile.postal_code_encrypted == "preserve-postal"


def test_identity_includes_the_support_id(client) -> None:
    response = client.get("/api/me/identity")
    assert response.status_code == 200
    support_id = response.json()["support_id"]
    assert len(support_id) == 8
    assert support_id.isdigit()


def test_identity_returns_and_updates_the_phone_number(client) -> None:
    """Regression test: the profile page had no way to enter a phone number
    at all, so every generated resume's ATS "contact" check failed on
    "phone missing" with no way to fix it -- update_identity accepted a
    phone but get_identity never returned it back for the form to show."""
    response = client.put("/api/me/identity", json={"phone": "360-809-2664"})
    assert response.status_code == 200
    assert response.json()["phone"] == "360-809-2664"

    response = client.get("/api/me/identity")
    assert response.status_code == 200
    assert response.json()["phone"] == "360-809-2664"
