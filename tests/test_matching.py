from kall.models.core import CareerProfile, Job
from kall.models.enums import WorkType
from kall.services.matching import (
    deterministic_match,
    is_out_of_scope,
    mentions_equity,
    requires_relocation,
    travel_percent_from_text,
)


def test_matching_rewards_title_keywords_remote_and_salary() -> None:
    profile = CareerProfile(
        user_id=1,
        name="Executive Engineering",
        target_titles=["Director of Quality Engineering"],
        industries=["SaaS"],
        include_keywords=["automation strategy", "CI/CD"],
        exclude_keywords=["manual tester"],
        work_types=["remote"],
        minimum_base=180000,
    )
    job = Job(
        source="test",
        company="Example",
        title="Director of Quality Engineering",
        description="SaaS leader for automation strategy and CI/CD.",
        url="https://example.com/job/1",
        work_type=WorkType.REMOTE,
        salary_min=190000,
        salary_max=230000,
    )
    score, strengths, gaps = deterministic_match(job, profile)
    assert score >= 85
    assert not gaps


def test_mentions_equity_recognises_common_phrasing() -> None:
    assert mentions_equity("Compensation includes base salary plus equity.")
    assert mentions_equity("You'll receive RSU grants annually.")
    assert not mentions_equity("Competitive salary and full benefits.")


def _job(**overrides) -> Job:
    defaults = dict(source="test", company="Example", title="Engineer", description="Build things.", url="https://example.com/job/equity")
    defaults.update(overrides)
    return Job(**defaults)


def test_equity_required_but_not_mentioned_is_a_gap() -> None:
    profile = CareerProfile(user_id=1, name="Test", equity_preference="required")
    _, _, gaps = deterministic_match(_job(description="Competitive base salary and full benefits."), profile)
    assert any("equity" in gap.lower() for gap in gaps)


def test_equity_mentioned_is_a_strength_when_it_matters() -> None:
    profile = CareerProfile(user_id=1, name="Test", equity_preference="nice_to_have")
    _, strengths, gaps = deterministic_match(_job(description="Includes equity compensation."), profile)
    assert any("equity" in strength.lower() for strength in strengths)
    assert not gaps


def test_equity_not_important_is_ignored_either_way() -> None:
    profile = CareerProfile(user_id=1, name="Test", equity_preference="not_important")
    _, strengths, gaps = deterministic_match(_job(description="Competitive base salary and full benefits."), profile)
    assert not any("equity" in s.lower() for s in strengths + gaps)


def test_requires_relocation_recognises_common_phrasing() -> None:
    assert requires_relocation("Candidates must relocate to our HQ.")
    assert not requires_relocation("Remote work is fully supported.")


def test_travel_percent_from_text_reads_the_highest_figure() -> None:
    assert travel_percent_from_text("Role involves up to 30% travel.") == 30
    assert travel_percent_from_text("Fully remote, no travel required.") is None


def test_relocation_required_but_not_open_to_it_is_a_gap() -> None:
    profile = CareerProfile(user_id=1, name="Test", relocation_preference="none")
    _, _, gaps = deterministic_match(_job(description="This role requires relocation to Austin."), profile)
    assert any("relocat" in gap.lower() for gap in gaps)


def test_relocation_required_is_ignored_when_open_to_relocating() -> None:
    profile = CareerProfile(user_id=1, name="Test", relocation_preference="preferred")
    _, _, gaps = deterministic_match(_job(description="This role requires relocation to Austin."), profile)
    assert not gaps


def test_travel_above_maximum_is_a_gap() -> None:
    profile = CareerProfile(user_id=1, name="Test", travel_max_percent=10)
    _, _, gaps = deterministic_match(_job(description="Expect up to 50% travel."), profile)
    assert any("travel" in gap.lower() for gap in gaps)


def test_travel_within_maximum_is_not_a_gap() -> None:
    profile = CareerProfile(user_id=1, name="Test", travel_max_percent=50)
    _, _, gaps = deterministic_match(_job(description="Expect up to 10% travel."), profile)
    assert not gaps


def test_is_out_of_scope_flags_excluded_keyword() -> None:
    profile = CareerProfile(user_id=1, name="P", exclude_keywords=["unpaid internship"])
    job = Job(
        source="test", company="Example", title="Unpaid Internship",
        description="", url="https://example.com/job/2",
    )
    assert is_out_of_scope(job, profile) == "Contains excluded keyword: unpaid internship"


def test_is_out_of_scope_flags_location_outside_scope() -> None:
    profile = CareerProfile(user_id=1, name="P", countries=["United States"])
    job = Job(
        source="test", company="Example", title="Engineer",
        description="", url="https://example.com/job/3", location="Berlin, Germany",
    )
    assert is_out_of_scope(job, profile) == "Location outside specified countries/regions"


def test_is_out_of_scope_allows_matching_location() -> None:
    profile = CareerProfile(user_id=1, name="P", countries=["United States"])
    job = Job(
        source="test", company="Example", title="Engineer",
        description="", url="https://example.com/job/4", location="Remote - United States",
    )
    assert is_out_of_scope(job, profile) is None


def test_is_out_of_scope_ignores_unset_location() -> None:
    profile = CareerProfile(user_id=1, name="P", countries=["United States"])
    job = Job(
        source="test", company="Example", title="Engineer",
        description="", url="https://example.com/job/5",
    )
    assert is_out_of_scope(job, profile) is None


def test_functional_area_alias_adds_one_ten_point_bonus_with_evidence() -> None:
    job = _job(title="Staff SDET", description="Quality assurance and test automation")
    profile = CareerProfile(user_id=1, name="Quality", functional_areas=["Quality Engineering", "Software Engineering"])
    score, strengths, gaps = deterministic_match(job, profile)
    assert score == 10
    assert len(strengths) == 1
    assert "Quality Engineering" in strengths[0] and "+10" in strengths[0]
    assert not gaps


def test_missing_functional_area_evidence_has_no_penalty_or_filter() -> None:
    profile = CareerProfile(user_id=1, name="Quality", functional_areas=["Quality Engineering"])
    assert deterministic_match(_job(), profile) == (0, [], [])
    assert is_out_of_scope(_job(), profile) is None


def test_custom_functional_areas_match_case_insensitively_on_phrase_boundaries() -> None:
    profile = CareerProfile(user_id=1, name="Custom", functional_areas=["Technical Writing"])
    assert deterministic_match(_job(description="TECHNICAL-WRITING experience"), profile)[0] == 10
    profile.functional_areas = ["art"]
    assert deterministic_match(_job(description="Start with smart devices"), profile)[0] == 0


def test_empty_or_blank_areas_leave_existing_scores_unchanged() -> None:
    job = _job(title="Engineer", description="SaaS automation")
    profile = CareerProfile(user_id=1, name="Engineering", target_titles=["Engineer"], industries=["SaaS"])
    before = deterministic_match(job, profile)
    profile.functional_areas = [" ", "!!!"]
    assert deterministic_match(job, profile) == before


def test_functional_area_bonus_cannot_exceed_the_hundred_point_score_cap() -> None:
    job = _job(title="Engineer", description="SaaS automation strategy CI/CD quality assurance",
               work_type=WorkType.REMOTE, salary_min=200000, salary_max=220000)
    profile = CareerProfile(user_id=1, name="P", target_titles=["Engineer"], industries=["SaaS"],
                            include_keywords=["automation", "strategy", "CI/CD"], minimum_base=180000,
                            functional_areas=["Quality Engineering"])
    assert deterministic_match(job, profile)[0] == 100


def test_functional_area_alignment_never_overrides_a_hard_exclusion() -> None:
    profile = CareerProfile(user_id=1, name="P", functional_areas=["Quality Engineering"], exclude_keywords=["unpaid"])
    job = _job(title="SDET", description="Unpaid role")
    assert is_out_of_scope(job, profile) == "Contains excluded keyword: unpaid"
