from kall.models.core import CareerProfile, Job
from kall.models.enums import WorkType
from kall.services.matching import deterministic_match, mentions_equity


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
