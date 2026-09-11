from kall.services.onboarding_ai import deterministic_career_strategy, infer_functional_areas
from kall.services.title_suggestions import related_titles


def test_a_director_title_offers_synonymous_domains_and_comparable_levels() -> None:
    offered = related_titles(["Director of Quality Engineering"])
    assert "Director of QE" in offered
    assert "Director of Quality Assurance" in offered
    assert "Head of Quality Engineering" in offered
    # Never a different band: a director is not offered VP or manager titles.
    assert not any(title.startswith(("VP", "Vice President", "Manager")) for title in offered)


def test_related_titles_never_repeat_what_is_already_confirmed_or_excluded() -> None:
    offered = related_titles(["Director of QE"], exclude=["director of quality assurance", "Head of QE"])
    lowered = {title.casefold() for title in offered}
    assert "director of qe" not in lowered
    assert "director of quality assurance" not in lowered
    assert "head of qe" not in lowered
    assert offered  # something else was still suggested


def test_individual_contributor_titles_swap_the_domain_phrase() -> None:
    offered = related_titles(["Senior Software Engineer"])
    assert "Senior Software Developer" in offered
    assert "Senior Application Engineer" in offered
    assert "QA Analyst" in related_titles(["Quality Assurance Analyst"])


def test_every_confirmed_title_contributes_to_the_suggestions() -> None:
    offered = related_titles(["Director of Quality Engineering", "Product Manager"], limit=6)
    assert any(title.startswith(("Head", "Senior Director", "Director")) for title in offered)
    assert "Product Owner" in offered


def test_unknown_titles_produce_no_invented_suggestions() -> None:
    assert related_titles(["Beekeeper"]) == []
    assert related_titles([]) == []


def test_functional_areas_are_inferred_from_resume_text_most_mentioned_first() -> None:
    text = (
        "Director of Quality Assurance. Built the test automation practice; grew the quality assurance "
        "team; partnered with the product manager on release readiness."
    )
    areas = infer_functional_areas(text)
    assert areas[0] == "Quality Engineering"
    assert "Product Management" in areas
    assert infer_functional_areas("") == []


def test_deterministic_strategy_carries_functional_areas() -> None:
    result = deterministic_career_strategy("Director of Quality Engineering\n2018 - Present\nLed test automation.")
    assert result is not None
    assert result["functional_areas"] == ["Quality Engineering"]


def test_related_titles_endpoint_answers_without_an_ai_key(client) -> None:
    response = client.post(
        "/api/me/career-profiles/related-titles",
        json={"titles": ["Head of Quality Engineering"], "exclude": ["Director of Quality Engineering"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ai_enabled"] is False
    assert "Head of QE" in body["titles"]
    assert "Director of Quality Engineering" not in body["titles"]

    empty = client.post("/api/me/career-profiles/related-titles", json={"titles": []})
    assert empty.status_code == 200
    assert empty.json()["titles"] == []
