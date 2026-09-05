"""GET /profile/onboarding used to trust a stored is_complete flag that only
the web wizard's final step ever set. A profile created any other way -- the
mobile app has no onboarding screen of its own, an admin action, a resumed
session -- left that flag false forever, stranding the account in an endless
redirect back to /onboarding despite already having a real career profile.
"""

from kall.models import CareerProfile
from kall.models.onboarding import OnboardingProgress
from sqlmodel import Session, select


def test_onboarding_self_heals_when_a_profile_already_exists_but_the_flag_was_never_set(
    client, engine,
) -> None:
    with Session(engine) as session:
        session.add(CareerProfile(user_id=client.user_id, name="Default"))
        session.commit()

    response = client.get("/api/profile/onboarding")
    assert response.status_code == 200
    assert response.json()["is_complete"] is True

    with Session(engine) as session:
        row = session.exec(
            select(OnboardingProgress).where(OnboardingProgress.user_id == client.user_id)
        ).first()
        assert row is not None
        assert row.is_complete is True
        assert row.current_step == "complete"


def test_onboarding_stays_incomplete_with_no_profile_yet(client) -> None:
    response = client.get("/api/profile/onboarding")
    assert response.status_code == 200
    assert response.json()["is_complete"] is False


def test_onboarding_does_not_flip_an_already_complete_row_back(client, engine) -> None:
    response = client.put(
        "/api/profile/onboarding",
        json={"current_step": "complete", "completed_steps": ["account"], "dismissed_steps": [], "is_complete": True},
    )
    assert response.status_code == 200

    response = client.get("/api/profile/onboarding")
    assert response.status_code == 200
    assert response.json()["is_complete"] is True
