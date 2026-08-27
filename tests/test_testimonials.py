from kall.models import Testimonial
from sqlmodel import Session


def test_testimonial_defaults_private():
    item = Testimonial(
        user_id=1,
        author_name="Former Coworker",
        relationship="peer",
        body="A thoughtful and reliable collaborator.",
    )
    assert item.status == "pending_review"
    assert item.include_on_profile is False
    assert item.include_in_applications is False
    assert item.permission_granted is False


def test_permission_can_be_recorded():
    item = Testimonial(
        user_id=1,
        author_name="Former Manager",
        relationship="manager",
        body="Led the team through a difficult release.",
        permission_granted=True,
        verified_via_request=True,
    )
    assert item.permission_granted is True
    assert item.verified_via_request is True


def _testimonial(engine, user_id):
    with Session(engine) as session:
        item = Testimonial(
            user_id=user_id, author_name="Former Manager", relationship="manager",
            body="Reliable and thoughtful.", permission_granted=True,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return item.id


def test_moderate_refuses_to_show_a_testimonial_that_is_not_approved(client, engine):
    """A single PUT could previously set include_on_profile=True while
    leaving status at pending_review -- permission_granted was the only
    thing checked. Today's one caller (ReferencesTab.tsx) always sends
    status: 'approved' alongside it, but the backend must not depend on
    that discipline for a guarantee its own docstring calls the worst
    failure this feature could have.
    """
    testimonial_id = _testimonial(engine, client.user_id)

    response = client.put(
        f"/api/testimonials/{testimonial_id}",
        json={"status": "pending_review", "include_on_profile": True, "include_in_applications": False},
    )
    assert response.status_code == 422


def test_moderate_allows_showing_it_once_approved(client, engine):
    testimonial_id = _testimonial(engine, client.user_id)

    response = client.put(
        f"/api/testimonials/{testimonial_id}",
        json={"status": "approved", "include_on_profile": True, "include_in_applications": False},
    )
    assert response.status_code == 200
    assert response.json()["include_on_profile"] is True
