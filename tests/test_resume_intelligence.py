
from fastapi.testclient import TestClient
from kall.clock import utcnow
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


def test_job_analyzer_recognizes_non_software_skills() -> None:
    """Regression test: SKILL_TERMS was entirely software/cloud/QA vocabulary,
    so a retail, hospitality, or healthcare posting -- with no Python or AWS
    anywhere in it -- returned empty required/preferred skills even when the
    posting clearly named real, matchable requirements."""
    result = analyze_job(
        """Restaurant Shift Lead
Required: Food Safety certification and Point of Sale experience.
Preferred: ServSafe and prior Guest Service experience.
You will lead the team during busy service periods.
"""
    )
    assert "food safety" in result["required_skills"]
    assert "point of sale" in result["required_skills"]
    assert "servsafe" in result["preferred_skills"]
    assert "guest service" in result["preferred_skills"]


def test_parser_does_not_invent_metrics() -> None:
    parsed, _ = parse_resume("Improved release quality across the platform.")
    assert parsed["achievements"] == []


def test_parser_extracts_a_role_title_paired_with_a_date_range() -> None:
    parsed, _ = parse_resume(
        """PROFESSIONAL EXPERIENCE
Director of Quality Engineering
Acme Corp | 2018 - Present
Led a global team of 40 engineers.

QA Manager
Beta Inc | Jan 2014 - Dec 2017
Built the first automation suite.
"""
    )
    assert "Director of Quality Engineering" in parsed["role_titles"]
    assert "QA Manager" in parsed["role_titles"]
    # 2014 (earliest start) through the current year (an open "Present" role).
    assert parsed["years_of_experience"] == utcnow().year - 2014


def test_parser_never_surfaces_a_title_without_a_nearby_date() -> None:
    # "Engineer" appears, but nothing dates it -- surfacing it anyway would be
    # a guess the resume never actually supported.
    parsed, _ = parse_resume("I am an engineer who cares about quality and craftsmanship.")
    assert parsed["role_titles"] == []
    assert parsed["years_of_experience"] is None


def test_parser_ignores_a_four_digit_number_that_is_not_a_real_year_range() -> None:
    parsed, _ = parse_resume("Reduced ticket volume by 2019 - 2020 percentage points across two dashboards.")
    # No genuine employment date range exists here even though the regex
    # shape matches -- both years are absurd as a career span on their own,
    # but the real guard is that no title-like line sits beside them.
    assert parsed["role_titles"] == []


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
