"""Skill spelling suggestions are advisory, and must not confidently mislead."""

import pytest
from kall.models import CareerProfile, ResumeDocument, Skill
from kall.services.skill_vocabulary import canonical_skill, normalize_skill, suggest_skill
from sqlmodel import Session

API = "/api/profile/skills/spellcheck"


@pytest.mark.parametrize(
    ("typed", "expected"),
    [
        ("Kubernets", "Kubernetes"),
        ("pyton", "Python"),
        ("Javascrpit", "JavaScript"),
        ("Docekr", "Docker"),
        ("Tensorlow", "TensorFlow"),
    ],
)
def test_obvious_typos_are_corrected(typed: str, expected: str) -> None:
    assert suggest_skill(typed) == expected


@pytest.mark.parametrize("typed", ["Python", "python", "  SQL  ", "React"])
def test_a_known_skill_is_never_flagged(typed: str) -> None:
    assert suggest_skill(typed) is None
    assert canonical_skill(typed) is not None


@pytest.mark.parametrize(
    "typed",
    ["Food Safety", "ServSafe", "Forklift Operation", "Patient Care",
     "Commercial Pilot License", "Customer Service", "HVAC"],
)
def test_non_software_skills_are_recognized(typed: str) -> None:
    """Regression test: the vocabulary was entirely software/tech terms, so
    every retail, hospitality, trades, aviation, and healthcare skill a
    person actually typed was treated as unrecognized rather than known --
    silently worse spellcheck coverage for anyone outside software."""
    assert canonical_skill(typed) is not None
    assert suggest_skill(typed) is None


@pytest.mark.parametrize("typed", ["Elm", "Go", "R", "Rsut"])
def test_short_terms_are_left_alone(typed: str) -> None:
    """Elm and Helm score 0.86 against each other and are both real skills.

    Confidently "correcting" one into the other is worse than staying quiet,
    because the user is likely to accept the suggestion.
    """
    assert suggest_skill(typed) is None


def test_an_unrecognised_skill_is_not_treated_as_a_mistake() -> None:
    # The vocabulary cannot be complete. Flagging everything outside it would
    # train users to ignore the check entirely.
    assert suggest_skill("Frobnicator Engineering") is None


def test_casing_is_the_users_to_choose() -> None:
    assert canonical_skill("PYTHON") == "Python"
    assert suggest_skill("PYTHON") is None


def test_normalize_collapses_whitespace() -> None:
    assert normalize_skill("  Machine   Learning ") == "Machine Learning"


def test_spellcheck_endpoint_reports_each_term(client) -> None:
    response = client.post(API, json={"names": ["Kubernets", "Python", "Frobnicator"]})
    assert response.status_code == 200, response.text
    assert response.json() == [
        {"input": "Kubernets", "canonical": None, "suggestion": "Kubernetes"},
        {"input": "Python", "canonical": "Python", "suggestion": None},
        {"input": "Frobnicator", "canonical": None, "suggestion": None},
    ]


def test_spellcheck_endpoint_drops_blank_entries(client) -> None:
    response = client.post(API, json={"names": ["  ", "", "Python"]})
    assert [row["input"] for row in response.json()] == ["Python"]


def test_skill_suggestions_are_grounded_in_resume_and_target_direction(client, engine) -> None:
    with Session(engine) as session:
        session.add(ResumeDocument(
            user_id=client.user_id, name="Chef resume.pdf", file_path="resume.pdf",
            mime_type="application/pdf", tags=["Menu Development", "Food Safety"],
        ))
        session.add(CareerProfile(
            user_id=client.user_id, name="Culinary consulting",
            include_keywords=["Cost Control", "Kitchen Leadership"],
        ))
        session.add(Skill(user_id=client.user_id, name="Food Safety"))
        session.commit()

    response = client.get("/api/profile/skills/suggestions")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["resume"] == [{"name": "Menu Development", "reason": "Listed on Chef resume.pdf"}]
    assert {item["name"] for item in body["role"]} == {"Cost Control", "Kitchen Leadership"}
    assert "Food Safety" not in str(body)
