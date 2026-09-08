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
