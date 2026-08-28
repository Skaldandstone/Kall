"""Job-independent resume quality checks.

_resume_score only ever checked metadata completeness (has text, tags,
target titles) -- it never caught an accidental duplicate line or the kind
of unspaced text run a multi-column PDF layout produces, the way Huntr's
resume checker does. No dictionary or network dependency is added, so real
spelling checking is out of scope here -- these two checks are what's
achievable without one.
"""

from kall.services.resume_proofreading import (
    estimated_page_count,
    find_repeated_lines,
    find_unspaced_runs,
    proofreading_gaps,
)


def test_find_repeated_lines_catches_an_accidental_duplicate() -> None:
    text = (
        "Led a cross-functional team of six engineers to ship the payments platform.\n"
        "Owned the quarterly roadmap for the identity team.\n"
        "Led a cross-functional team of six engineers to ship the payments platform.\n"
    )
    assert find_repeated_lines(text) == ["Led a cross-functional team of six engineers to ship the payments platform."]


def test_short_lines_are_not_flagged_as_repeated() -> None:
    # Section headers and dates repeat by design -- "2020" appearing twice is
    # not a copy-paste mistake.
    text = "Experience\n2020\nEducation\n2020\n"
    assert find_repeated_lines(text) == []


def test_find_unspaced_runs_catches_column_bleed() -> None:
    merged = "Skills" + "Python" * 10 + "ProjectsExperienceLeadership"
    assert find_unspaced_runs(f"Some normal text.\n{merged}\nMore normal text.")


def test_normal_prose_has_no_unspaced_runs() -> None:
    text = "This is a perfectly normal resume line with regular spacing throughout."
    assert find_unspaced_runs(text) == []


def test_estimated_page_count_scales_with_word_count() -> None:
    assert estimated_page_count("") == 0
    assert estimated_page_count(" ".join(["word"] * 600)) == 1.0
    assert estimated_page_count(" ".join(["word"] * 1800)) == 3.0


def test_proofreading_gaps_is_empty_for_clean_text() -> None:
    text = "A concise, well-formatted resume with no duplicated lines and normal spacing."
    assert proofreading_gaps(text) == []


def test_proofreading_gaps_flags_a_long_resume() -> None:
    text = " ".join(["word"] * 2000)
    gaps = proofreading_gaps(text)
    assert any("pages" in gap for gap in gaps)


def test_the_resume_intelligence_endpoint_surfaces_a_repeated_line(client) -> None:
    """Integration point: _resume_score folds proofreading_gaps into the
    same "gaps" list the resume-intelligence page already renders under
    "Next improvements" -- no new UI surface needed."""
    duplicated = "Delivered a major platform migration ahead of schedule and under budget.\n" * 2
    upload = client.post(
        "/api/me/resumes",
        files={"file": ("resume.txt", duplicated.encode(), "text/plain")},
    )
    assert upload.status_code == 200, upload.text

    response = client.get("/api/me/resume-intelligence")
    assert response.status_code == 200, response.text
    row = next(row for row in response.json()["resumes"] if row["id"] == upload.json()["id"])
    assert any("duplicate" in gap for gap in row["gaps"])
