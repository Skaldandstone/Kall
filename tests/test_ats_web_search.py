"""build_ats_queries() had zero direct test coverage despite being what both
GET /discovery/ats-search/{id} and every discovery run actually search for --
a regression here silently changes what every user's hidden-market search
looks for, with nothing to catch it.
"""

from kall.models import CareerProfile
from kall.services.ats_web_search import ATS_DOMAINS, build_ats_queries


def _profile(**overrides) -> CareerProfile:
    defaults = dict(user_id=1, name="Backend Leadership")
    defaults.update(overrides)
    return CareerProfile(**defaults)


def test_every_ats_domain_is_represented_in_the_site_clause() -> None:
    query = build_ats_queries(_profile())[0]["query"]
    for _, domain in ATS_DOMAINS:
        assert f"site:{domain}" in query


def test_titles_are_or_grouped_and_quoted() -> None:
    query = build_ats_queries(_profile(target_titles=["Staff Engineer", "Principal Engineer"]))[0]["query"]
    assert '"Staff Engineer" OR "Principal Engineer"' in query


def test_exclusions_are_negated_not_or_grouped() -> None:
    query = build_ats_queries(_profile(target_titles=["Engineer"], exclude_keywords=["Contract", "Internship"]))[0]["query"]
    assert '-"Contract"' in query
    assert '-"Internship"' in query
    assert 'OR -"Contract"' not in query


def test_remote_work_type_adds_the_remote_clause() -> None:
    query = build_ats_queries(_profile(work_types=["remote"]))[0]["query"]
    assert 'remote OR "work from home"' in query


def test_onsite_only_does_not_add_the_remote_clause() -> None:
    query = build_ats_queries(_profile(work_types=["on_site"]))[0]["query"]
    assert "work from home" not in query


def test_locations_combine_states_and_countries() -> None:
    query = build_ats_queries(_profile(states_regions=["Texas"], countries=["Canada"]))[0]["query"]
    assert '"Texas" OR "Canada"' in query


def test_an_empty_profile_falls_back_to_searching_its_own_name() -> None:
    # work_types defaults to ["remote"] on the model itself, so an otherwise
    # empty profile still needs it cleared to exercise the true fallback path.
    query = build_ats_queries(_profile(name="Game Art Track", work_types=[]))[0]["query"]
    assert '"Game Art Track"' in query


def test_the_search_urls_are_valid_and_url_encode_the_query() -> None:
    result = build_ats_queries(_profile(target_titles=["Engineer & Lead"]))[0]
    assert result["google_url"].startswith("https://www.google.com/search?q=")
    assert result["bing_url"].startswith("https://www.bing.com/search?q=")
    # An unencoded "&" inside the query would be read as a second query
    # parameter rather than part of the search string.
    assert "%26" in result["google_url"]
    assert "%26" in result["bing_url"]


def test_keyword_and_exclusion_limits_are_respected() -> None:
    query = build_ats_queries(_profile(
        include_keywords=[f"kw{i}" for i in range(10)],
        exclude_keywords=[f"ex{i}" for i in range(10)],
    ))[0]["query"]
    assert "kw4" in query and "kw5" not in query  # keywords capped at 5
    assert "ex4" in query and "ex5" not in query  # exclusions capped at 5
