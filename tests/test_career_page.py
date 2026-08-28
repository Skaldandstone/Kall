"""The career page is the only thing in Kall that serves strangers.

Most of these tests are therefore about what it refuses to publish.
"""

import pytest
from kall.models import CareerPage, Employment, Skill, Testimonial, User
from kall.services.career_page import SlugError, validate_slug
from sqlmodel import Session, select

ME = "/api/me/career-page"


def public(slug: str) -> str:
    return f"/api/career-pages/{slug}"


def test_slug_rules() -> None:
    assert validate_slug("James-Shattuck") == "james-shattuck"
    for bad in ("ab", "-leading", "trailing-", "has space", "UPPER!", "x" * 41):
        with pytest.raises(SlugError):
            validate_slug(bad)


def test_reserved_slugs_are_refused() -> None:
    # These would collide with real routes, or imply Kall itself is speaking.
    for reserved in ("api", "settings", "sign-in", "kall"):
        with pytest.raises(SlugError):
            validate_slug(reserved)


def test_a_page_is_created_unpublished_with_default_sections(client) -> None:
    body = client.get(ME).json()
    assert body["page"]["published"] is False, "a page must never be public on creation"
    kinds = [section["kind"] for section in body["sections"]]
    # Ordered to make an argument, not to list facts.
    assert kinds[:3] == ["intro", "thesis", "history"]
    assert [s["position"] for s in body["sections"]] == list(range(len(body["sections"])))


def test_an_unpublished_page_is_not_reachable(client) -> None:
    slug = client.get(ME).json()["page"]["slug"]
    response = client.get(public(slug))
    # 404 rather than 403: whether a slug is taken by an unpublished page is
    # not a stranger's business.
    assert response.status_code == 404


def test_publishing_makes_it_reachable(client) -> None:
    slug = client.get(ME).json()["page"]["slug"]
    client.patch(ME, json={"published": True, "headline": "Head of Technology"})
    body = client.get(public(slug)).json()
    assert body["headline"] == "Head of Technology"
    assert body["slug"] == slug


def test_the_public_payload_carries_no_contact_details(client) -> None:
    slug = client.get(ME).json()["page"]["slug"]
    client.patch(ME, json={"published": True})
    body = client.get(public(slug)).json()
    serialized = str(body).lower()
    for leaked in ("email", "phone", "address", "postal"):
        assert leaked not in serialized, f"{leaked} must never reach a public page"


def test_a_taken_slug_is_refused(client, engine) -> None:
    with Session(engine) as session:
        other = User(clerk_user_id="user_other", email="other@example.com", full_name="Other")
        session.add(other)
        session.commit()
        session.refresh(other)
        session.add(CareerPage(user_id=other.id, slug="taken-name"))
        session.commit()

    response = client.patch(ME, json={"slug": "taken-name"})
    assert response.status_code == 409


def test_an_invalid_slug_explains_itself(client) -> None:
    response = client.patch(ME, json={"slug": "No Spaces Allowed"})
    assert response.status_code == 422
    assert "lowercase" in response.json()["detail"]


def test_sections_can_be_added_reordered_and_hidden(client) -> None:
    created = client.post(ME + "/sections", json={"kind": "custom", "title": "Speaking"})
    assert created.status_code == 200
    new_id = created.json()["id"]

    ids = [section["id"] for section in client.get(ME).json()["sections"]]
    reversed_ids = list(reversed(ids))
    assert client.post(ME + "/sections/reorder", json={"section_ids": reversed_ids}).status_code == 200
    assert [s["id"] for s in client.get(ME).json()["sections"]] == reversed_ids

    # Hiding keeps the section and its content; it just stops rendering.
    client.patch(f"{ME}/sections/{new_id}", json={"visible": False})
    assert any(s["id"] == new_id for s in client.get(ME).json()["sections"])


def test_reorder_requires_the_whole_page(client) -> None:
    ids = [section["id"] for section in client.get(ME).json()["sections"]]
    response = client.post(ME + "/sections/reorder", json={"section_ids": ids[:2]})
    assert response.status_code == 422


def test_a_hidden_section_is_absent_from_the_public_page(client) -> None:
    page = client.get(ME).json()
    slug = page["page"]["slug"]
    thesis = next(s for s in page["sections"] if s["kind"] == "thesis")
    client.patch(f"{ME}/sections/{thesis['id']}", json={"visible": False, "body": "secret draft"})
    client.patch(ME, json={"published": True})

    body = client.get(public(slug)).json()
    assert all(section["kind"] != "thesis" for section in body["sections"])
    assert "secret draft" not in str(body)


def test_an_unknown_section_kind_is_refused(client) -> None:
    response = client.post(ME + "/sections", json={"kind": "eeo", "title": "Demographics"})
    assert response.status_code == 422


def test_a_sourced_section_shows_records_and_respects_curation(client, engine) -> None:
    with Session(engine) as session:
        for employer in ("Northwind", "Acme", "Initech"):
            session.add(Employment(user_id=client.user_id, employer=employer, job_title="Engineer"))
        session.commit()
        ids = [row.id for row in session.exec(select(Employment)) ]

    page = client.get(ME).json()
    slug = page["page"]["slug"]
    history = next(s for s in page["sections"] if s["kind"] == "history")

    client.patch(ME, json={"published": True})
    # No curation means all of them.
    body = client.get(public(slug)).json()
    section = next(s for s in body["sections"] if s["kind"] == "history")
    assert len(section["items"]) == 3

    # Curating picks both the subset and its order.
    client.patch(f"{ME}/sections/{history['id']}", json={"item_ids": [ids[2], ids[0]]})
    section = next(s for s in client.get(public(slug)).json()["sections"] if s["kind"] == "history")
    assert [item["employer"] for item in section["items"]] == ["Initech", "Northwind"]


def test_a_deleted_record_does_not_break_the_page(client, engine) -> None:
    with Session(engine) as session:
        row = Skill(user_id=client.user_id, name="Python")
        session.add(row)
        session.commit()
        skill_id = row.id

    page = client.get(ME).json()
    slug = page["page"]["slug"]
    skills = next(s for s in page["sections"] if s["kind"] == "skills")
    client.patch(f"{ME}/sections/{skills['id']}", json={"item_ids": [skill_id, 9999]})
    client.patch(ME, json={"published": True})

    section = next(s for s in client.get(public(slug)).json()["sections"] if s["kind"] == "skills")
    assert [item["name"] for item in section["items"]] == ["Python"]


def test_primary_skills_are_surfaced_first_and_flagged(client, engine) -> None:
    """is_primary ("Highlight as a primary skill") was collectible but
    nothing ever read it -- neither exposed on the public page nor used to
    order the section."""
    with Session(engine) as session:
        session.add(Skill(user_id=client.user_id, name="Python", is_primary=False))
        session.add(Skill(user_id=client.user_id, name="Rust", is_primary=True))
        session.commit()

    page = client.get(ME).json()
    slug = page["page"]["slug"]
    client.patch(ME, json={"published": True})

    section = next(s for s in client.get(public(slug)).json()["sections"] if s["kind"] == "skills")
    assert [item["name"] for item in section["items"]] == ["Rust", "Python"]
    assert [item["is_primary"] for item in section["items"]] == [True, False]


def test_a_curated_skills_order_overrides_the_primary_sort(client, engine) -> None:
    with Session(engine) as session:
        session.add(Skill(user_id=client.user_id, name="Python", is_primary=False))
        primary = Skill(user_id=client.user_id, name="Rust", is_primary=True)
        session.add(primary)
        session.commit()
        session.refresh(primary)
        python_id = session.exec(select(Skill).where(Skill.name == "Python")).one().id

    page = client.get(ME).json()
    slug = page["page"]["slug"]
    skills = next(s for s in page["sections"] if s["kind"] == "skills")
    client.patch(f"{ME}/sections/{skills['id']}", json={"item_ids": [python_id, primary.id]})
    client.patch(ME, json={"published": True})

    section = next(s for s in client.get(public(slug)).json()["sections"] if s["kind"] == "skills")
    assert [item["name"] for item in section["items"]] == ["Python", "Rust"]


def test_only_cleared_testimonials_are_published(client, engine) -> None:
    """A testimonial names a real third party who consented to something specific."""
    with Session(engine) as session:
        common = {"user_id": client.user_id, "relationship": "manager", "body": "Great to work with."}
        session.add(Testimonial(author_name="Cleared", include_on_profile=True,
                                permission_granted=True, status="approved", **common))
        session.add(Testimonial(author_name="NoProfileFlag", include_on_profile=False,
                                permission_granted=True, status="approved", **common))
        session.add(Testimonial(author_name="NoPermission", include_on_profile=True,
                                permission_granted=False, status="approved", **common))
        # Cleared on every other flag but never actually approved -- this is
        # the exact gap api_testimonials.py's moderate() now refuses to
        # create through the API; a row already sitting in the database this
        # way (migrated data, a bug predating that fix) must still not
        # publish.
        session.add(Testimonial(author_name="NeverApproved", include_on_profile=True,
                                permission_granted=True, status="pending_review", **common))
        session.commit()

    client.post(ME + "/sections", json={"kind": "testimonials", "title": "References"})
    slug = client.get(ME).json()["page"]["slug"]
    client.patch(ME, json={"published": True})

    section = next(s for s in client.get(public(slug)).json()["sections"] if s["kind"] == "testimonials")
    assert [item["author_name"] for item in section["items"]] == ["Cleared"]


def test_another_users_section_cannot_be_edited(client, engine) -> None:
    with Session(engine) as session:
        other = User(clerk_user_id="user_stranger", email="stranger@example.com", full_name="Stranger")
        session.add(other)
        session.commit()
        session.refresh(other)
        page = CareerPage(user_id=other.id, slug="stranger-page")
        session.add(page)
        session.commit()
        session.refresh(page)
        from kall.models import CareerPageSection

        section = CareerPageSection(
            user_id=other.id, career_page_id=page.id, kind="thesis", title="Theirs"
        )
        session.add(section)
        session.commit()
        section_id = section.id

    assert client.patch(f"{ME}/sections/{section_id}", json={"title": "Mine now"}).status_code == 404
    assert client.delete(f"{ME}/sections/{section_id}").status_code == 404
