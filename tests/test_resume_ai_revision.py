"""The AI revision flow (POST /me/resumes/{id}/apply-recommendations and its
preview counterpart) must actually move _resume_score, not just rewrite
prose. See api_resume_intelligence.py for the score rubric this exercises.
"""

from fastapi.testclient import TestClient
from kall.models import CareerProfile, ResumeDocument
from sqlmodel import Session


def _make_resume(engine, user_id: int, **overrides) -> int:
    fields = {
        "user_id": user_id, "name": "Resume", "file_path": "data/resumes/r.txt", "mime_type": "text/plain",
        "byte_size": 100, "extracted_text": "Solid experience leading delivery teams and shipping reliable systems.",
    }
    fields.update(overrides)
    with Session(engine) as session:
        resume = ResumeDocument(**fields)
        session.add(resume)
        session.commit()
        session.refresh(resume)
        return resume.id


def test_applying_a_tag_recommendation_raises_the_readiness_score(client: TestClient, engine) -> None:
    resume_id = _make_resume(engine, client.user_id, is_default=True)

    recommendation = {
        "id": "skills-metadata", "section": "Skills", "title": "Add tags", "reason": "improves matching",
        "current_text": "No resume skill tags are currently stored.", "proposed_text": "Testing, automation.",
        "confidence": 88, "tags": ["testing", "automation"], "target_titles": [], "industries": [],
    }

    before = client.get("/api/me/resume-intelligence").json()
    before_score = next(row for row in before["resumes"] if row["id"] == resume_id)["readiness_score"]

    response = client.post(
        f"/api/me/resumes/{resume_id}/apply-recommendations",
        json={"recommendation_ids": ["skills-metadata"], "recommendations": [recommendation]},
    )
    assert response.status_code == 200
    new_id = response.json()["resume_id"]

    after = client.get("/api/me/resume-intelligence").json()
    new_row = next(row for row in after["resumes"] if row["id"] == new_id)
    assert new_row["tags"] == ["testing", "automation"]
    assert new_row["readiness_score"] > before_score


def test_applying_a_recommendation_preserves_is_default_from_the_source(client: TestClient, engine) -> None:
    resume_id = _make_resume(engine, client.user_id, is_default=True, tags=["existing"])

    recommendation = {
        "id": "skills-metadata", "section": "Skills", "title": "Add tags", "reason": "improves matching",
        "current_text": "x", "proposed_text": "y", "confidence": 88, "tags": ["more-tags"],
        "target_titles": [], "industries": [],
    }

    response = client.post(
        f"/api/me/resumes/{resume_id}/apply-recommendations",
        json={"recommendation_ids": ["skills-metadata"], "recommendations": [recommendation]},
    )
    assert response.status_code == 200
    new_id = response.json()["resume_id"]

    dashboard = client.get("/api/me/resume-intelligence").json()
    rows_by_id = {row["id"]: row for row in dashboard["resumes"]}
    # The revision inherits default status from its source...
    assert rows_by_id[new_id]["is_default"] is True
    # ...and the stale source no longer double-counts as default too.
    assert rows_by_id[resume_id]["is_default"] is False


def test_a_non_default_resume_produces_a_non_default_revision(client: TestClient, engine) -> None:
    resume_id = _make_resume(engine, client.user_id, is_default=False, tags=["existing"])

    recommendation = {
        "id": "skills-metadata", "section": "Skills", "title": "Add tags", "reason": "improves matching",
        "current_text": "x", "proposed_text": "y", "confidence": 88, "tags": ["more-tags"],
        "target_titles": [], "industries": [],
    }

    response = client.post(
        f"/api/me/resumes/{resume_id}/apply-recommendations",
        json={"recommendation_ids": ["skills-metadata"], "recommendations": [recommendation]},
    )
    assert response.status_code == 200
    dashboard = client.get("/api/me/resume-intelligence").json()
    new_row = next(row for row in dashboard["resumes"] if row["id"] == response.json()["resume_id"])
    assert new_row["is_default"] is False


def test_fallback_recommendations_fill_target_titles_from_the_career_profile(client: TestClient, engine) -> None:
    resume_id = _make_resume(engine, client.user_id, target_titles=[])
    with Session(engine) as session:
        session.add(CareerProfile(user_id=client.user_id, name="Primary", target_titles=["Director of Quality"]))
        session.commit()

    response = client.post(f"/api/me/resumes/{resume_id}/recommendations")
    assert response.status_code == 200
    recs = {rec["id"]: rec for rec in response.json()["recommendations"]}
    assert "target-titles" in recs
    assert recs["target-titles"]["target_titles"] == ["Director of Quality"]


def test_fallback_recommendations_fix_a_duplicated_line(client: TestClient, engine) -> None:
    duplicated = "Led a global quality organization across five continents and twelve products."
    text = f"PROFESSIONAL EXPERIENCE\n{duplicated}\nSome other unique line here.\n{duplicated}\n"
    resume_id = _make_resume(engine, client.user_id, extracted_text=text)

    response = client.post(f"/api/me/resumes/{resume_id}/recommendations")
    assert response.status_code == 200
    recs = {rec["id"]: rec for rec in response.json()["recommendations"]}
    assert "proofreading-dedupe" in recs
    assert recs["proofreading-dedupe"]["proposed_text"].count(duplicated) == 1


def test_preview_recommendations_reports_projected_score_without_persisting(client: TestClient, engine) -> None:
    resume_id = _make_resume(engine, client.user_id, tags=[])

    recommendation = {
        "id": "skills-metadata", "section": "Skills", "title": "Add tags", "reason": "improves matching",
        "current_text": "x", "proposed_text": "y", "confidence": 88, "tags": ["testing"],
        "target_titles": [], "industries": [],
    }

    response = client.post(
        f"/api/me/resumes/{resume_id}/preview-recommendations",
        json={"recommendation_ids": ["skills-metadata"], "recommendations": [recommendation]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["projected_score"] > body["current_score"]
    assert body["tags"] == ["testing"]

    # Nothing was actually created or changed.
    dashboard = client.get("/api/me/resume-intelligence").json()
    assert dashboard["summary"]["resume_count"] == 1
    assert dashboard["resumes"][0]["tags"] == []
