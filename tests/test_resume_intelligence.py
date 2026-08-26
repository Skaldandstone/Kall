
from fastapi.testclient import TestClient
from kall.services.intelligence import analyze_job, parse_resume


def test_resume_parser_extracts_verified_source_candidates() -> None:
    parsed, warnings = parse_resume(
        """PROFESSIONAL EXPERIENCE
Director of Quality Engineering
Led a global team of 40 engineers and increased automation coverage to 80%.
SKILLS
Python AWS Playwright CI/CD
"""
    )
    assert "python" in parsed["skills"]
    assert "aws" in parsed["skills"]
    assert parsed["achievements"][0]["metrics"] == ["40", "80%"]
    assert not warnings


def test_job_analyzer_separates_explicit_and_inferred_signals() -> None:
    result = analyze_job(
        """Director of Engineering Excellence
Required: 10 years of leadership experience and Python.
Preferred: AWS certification and Kubernetes.
You will lead quality strategy across the organization.
"""
    )
    assert "python" in result["required_skills"]
    assert "kubernetes" in result["preferred_skills"]
    assert "director" in result["leadership_signals"]
    assert result["explicit_requirements"]
    assert result["inferred_signals"]


def test_parser_does_not_invent_metrics() -> None:
    parsed, _ = parse_resume("Improved release quality across the platform.")
    assert parsed["achievements"] == []


def test_parse_endpoint_response_survives_the_achievement_insert_commit(client: TestClient) -> None:
    """Regression: parse_resume_endpoint commits once to save the ResumeParse
    row, then commits again after inserting Achievement rows. That second
    commit expires every object the session has already loaded (including
    the ResumeParse row about to be returned) -- without a refresh right
    before returning it, FastAPI serialized an object with expired
    attributes and silently produced an empty `{}` response body instead of
    a real error or the actual parse result."""
    upload = client.post(
        "/api/me/resumes",
        files={"file": ("resume.txt",
                        b"Director of Quality Engineering. Led a global team of 40 engineers "
                        b"and increased automation coverage to 80%.",
                        "text/plain")},
    )
    assert upload.status_code == 200
    resume_id = upload.json()["id"]

    response = client.post(f"/api/intelligence/resumes/{resume_id}/parse")
    assert response.status_code == 200
    body = response.json()
    assert body["resume_id"] == resume_id
    assert body["warnings"] == []
    assert body["parsed_json"]["achievements"][0]["metrics"] == ["40", "80%"]
