import hashlib

import pytest
from kall.models import CareerProfile, Job
from kall.services.matching import deterministic_match
from kall.services.opportunities import material_fingerprint, normalize
from kall.services.posting_evidence import visible_department_names


def posting(metadata=None, **overrides):
    return Job(**({"source": "test", "company": "Example", "title": "Engineer",
                  "description": "Build systems", "url": "https://example.test/1",
                  "metadata_json": metadata or {}} | overrides))


@pytest.mark.parametrize("metadata", [
    {"team": "Quality Engineering"},
    {"department": "Quality Engineering"},
    {"departments": [{"id": 42, "name": "Quality Engineering"}]},
])
def test_department_name_adds_ten_points_with_visible_evidence(metadata):
    profile = CareerProfile(user_id=1, name="Quality", functional_areas=["Quality Engineering"])
    before = deterministic_match(posting({"team": "Support"}), profile)
    score, strengths, gaps = deterministic_match(posting(metadata), profile)
    assert score == before[0] + 10
    assert strengths == ["Functional-area alignment: Quality Engineering (department/team mentions Quality Engineering; +10)"]
    assert gaps == before[2] == []
    assert material_fingerprint(posting(metadata)) != material_fingerprint(posting({"team": "Support"}))


def test_body_and_multiple_department_matches_still_award_one_bonus():
    profile = CareerProfile(user_id=1, name="Quality", functional_areas=["Quality Engineering", "Software Engineering"])
    job = posting({"team": "Quality Engineering", "department": "Software Engineering"}, description="test automation")
    score, strengths, _ = deterministic_match(job, profile)
    assert score == 10 and len(strengths) == 1
    assert "posting mentions test automation" in strengths[0]


def test_ids_order_case_duplicates_and_bookkeeping_do_not_change_evidence_or_fingerprint():
    first = {"departments": [{"id": 1, "name": "Quality Engineering"}, {"id": 2, "name": "Support"}]}
    second = {"departments": [{"id": 90, "name": " SUPPORT "}, {"id": 80, "name": "quality-engineering", "updated_at": "new"}],
              "team": "QUALITY ENGINEERING", "fingerprint": "provider bookkeeping", "offices": [{"id": 50}]}
    assert visible_department_names(first) == visible_department_names(second) == ["quality engineering", "support"]
    assert material_fingerprint(posting(first)) == material_fingerprint(posting(second))
    profile = CareerProfile(user_id=1, name="Quality", functional_areas=["Quality Engineering"])
    assert deterministic_match(posting(first), profile) == deterministic_match(posting(second), profile)


@pytest.mark.parametrize("metadata", [None, {}, {"department": {"id": "Quality Engineering"}},
                                         {"departments": [None, 12, {"name": None}]},
                                         {"offices": [{"name": "Quality Engineering"}], "other": "Quality Engineering"}])
def test_no_visible_department_names_preserve_legacy_fingerprint_and_score(metadata):
    job = posting(metadata)
    profile = CareerProfile(user_id=1, name="Quality", functional_areas=["Quality Engineering"])
    assert deterministic_match(job, profile) == deterministic_match(posting(), profile)
    content = "|".join([normalize(job.title), normalize(job.location), normalize(job.description),
                        str(job.salary_min or ""), str(job.salary_max or ""), str(job.work_type or "")])
    assert material_fingerprint(job) == hashlib.sha256(content.encode()).hexdigest()


def test_separate_department_names_cannot_create_a_phrase_across_boundaries():
    profile = CareerProfile(user_id=1, name="Quality", functional_areas=["Quality Engineering"])
    assert deterministic_match(posting({"departments": ["Quality", "Engineering"]}), profile)[0] == 0
