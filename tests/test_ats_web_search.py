"""build_ats_queries() had zero direct test coverage despite being what both
GET /discovery/ats-search/{id} and every discovery run actually search for --
a regression here silently changes what every user's hidden-market search
looks for, with nothing to catch it.
"""

from kall.models import CareerProfile
from kall.services.ats_web_search import (
    ALL_SEARCH_DOMAINS,
    ATS_DOMAINS,
    JOB_BOARD_DOMAINS,
    build_ats_queries,
    build_search_intent,
)


def _profile(**overrides) -> CareerProfile:
    defaults = dict(user_id=1, name="Backend Leadership")
    defaults.update(overrides)
    return CareerProfile(**defaults)


def test_one_query_per_domain_not_one_merged_query() -> None:
    # Google stops processing a query after ~32 words -- OR-ing every site
    # into one query used up that budget before the actual title/location/
    # keyword boolean was ever read. One site: term per query leaves the
    # whole budget for the boolean that matters.
    queries = build_ats_queries(_profile())
    assert len(queries) == len(ALL_SEARCH_DOMAINS)
    for (provider, domain), result in zip(ALL_SEARCH_DOMAINS, queries, strict=True):
        assert result["provider"] == provider
        assert result["domain"] == domain
        assert result["query"].startswith(f"site:{domain} ")
        assert result["query"].count("site:") == 1


def test_every_ats_domain_gets_its_own_query() -> None:
    queries = build_ats_queries(_profile())
    domains = {result["domain"] for result in queries}
    for _, domain in ATS_DOMAINS:
        assert domain in domains


def test_every_job_board_domain_gets_its_own_query() -> None:
    queries = build_ats_queries(_profile())
    domains = {result["domain"] for result in queries}
    for _, domain in JOB_BOARD_DOMAINS:
        assert domain in domains


def test_domains_list_has_no_duplicates() -> None:
    domains = [domain for _, domain in ALL_SEARCH_DOMAINS]
    assert len(domains) == len(set(domains))


def test_every_per_site_query_carries_the_same_intent() -> None:
    intent = build_search_intent(_profile(target_titles=["Staff Engineer"]))
    queries = build_ats_queries(_profile(target_titles=["Staff Engineer"]))
    for result in queries:
        assert result["query"] == f"site:{result['domain']} {intent}"


def test_industries_narrow_the_query() -> None:
    """A title like "Quality Assurance Director" alone pulls in every
    industry that title exists in -- specifying an industry should actually
    narrow the search, not just score matches after the fact."""
    intent = build_search_intent(_profile(
        target_titles=["Quality Assurance Director"], industries=["Pharmaceuticals", "Food Safety"],
    ))
    assert '"Pharmaceuticals" OR "Food Safety"' in intent


def test_no_industry_specified_does_not_add_an_empty_clause() -> None:
    intent = build_search_intent(_profile(target_titles=["Engineer"], industries=[]))
    assert "()" not in intent


def test_titles_are_or_grouped_and_quoted() -> None:
    intent = build_search_intent(_profile(target_titles=["Staff Engineer", "Principal Engineer"]))
    assert '"Staff Engineer" OR "Principal Engineer"' in intent


def test_exclusions_are_negated_not_or_grouped() -> None:
    intent = build_search_intent(_profile(target_titles=["Engineer"], exclude_keywords=["Contract", "Internship"]))
    assert '-"Contract"' in intent
    assert '-"Internship"' in intent
    assert 'OR -"Contract"' not in intent


def test_remote_work_type_adds_the_remote_clause() -> None:
    intent = build_search_intent(_profile(work_types=["remote"]))
    assert 'remote OR "work from home"' in intent


def test_onsite_only_does_not_add_the_remote_clause() -> None:
    intent = build_search_intent(_profile(work_types=["on_site"]))
    assert "work from home" not in intent


def test_locations_combine_states_and_countries() -> None:
    intent = build_search_intent(_profile(states_regions=["Texas"], countries=["Canada"]))
    assert '"Texas" OR "Canada"' in intent


def test_an_empty_profile_falls_back_to_searching_its_own_name() -> None:
    # work_types defaults to ["remote"] on the model itself, so an otherwise
    # empty profile still needs it cleared to exercise the true fallback path.
    intent = build_search_intent(_profile(name="Game Art Track", work_types=[]))
    assert '"Game Art Track"' in intent


def test_the_search_urls_are_valid_and_url_encode_the_query() -> None:
    result = build_ats_queries(_profile(target_titles=["Engineer & Lead"]))[0]
    assert result["google_url"].startswith("https://www.google.com/search?q=")
    assert result["bing_url"].startswith("https://www.bing.com/search?q=")
    # An unencoded "&" inside the query would be read as a second query
    # parameter rather than part of the search string.
    assert "%26" in result["google_url"]
    assert "%26" in result["bing_url"]


def test_keyword_and_exclusion_limits_are_respected() -> None:
    intent = build_search_intent(_profile(
        include_keywords=[f"kw{i}" for i in range(10)],
        exclude_keywords=[f"ex{i}" for i in range(10)],
    ))
    assert "kw4" in intent and "kw5" not in intent  # keywords capped at 5
    assert "ex4" in intent and "ex5" not in intent  # exclusions capped at 5


def test_functional_areas_broaden_the_same_title_group_and_retain_constraints() -> None:
    intent = build_search_intent(_profile(
        target_titles=["QA Director"], functional_areas=["Quality Engineering"], industries=["SaaS"],
        include_keywords=["leadership"], exclude_keywords=["unpaid"], countries=["Canada"],
    ))
    role_group = '("QA Director" OR "Quality Engineering" OR "quality assurance" OR "test automation" OR "software test engineer" OR "SDET")'
    assert role_group in intent
    for constraint in ['("SaaS")', '("leadership")', '("Canada")', '-"unpaid"']:
        assert constraint in intent


def test_custom_areas_and_aliases_are_supported_without_duplicate_expansion() -> None:
    intent = build_search_intent(_profile(functional_areas=["quality assurance", "Quality Engineering", "Technical Writing"]))
    assert intent.count('"SDET"') == 1
    assert '"Technical Writing"' in intent


def test_empty_functional_areas_do_not_change_the_existing_title_query() -> None:
    ordinary = _profile(target_titles=["Engineer"], industries=["SaaS"], include_keywords=["Python"])
    empty = _profile(target_titles=["Engineer"], industries=["SaaS"], include_keywords=["Python"], functional_areas=[])
    assert build_search_intent(ordinary) == build_search_intent(empty)


def test_functional_area_query_expansion_is_bounded() -> None:
    intent = build_search_intent(_profile(functional_areas=[f"Custom Area {i}" for i in range(6)]))
    assert '"Custom Area 4"' in intent
    assert '"Custom Area 5"' not in intent
