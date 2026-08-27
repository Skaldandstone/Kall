"""The preflight check.

Its whole job is to distinguish three states that are otherwise identical
from the outside, so each one gets a distinct exit code.
"""

from kall.config import get_settings
from kall.jobs import check_ai


def test_no_key_is_reported_rather_than_looking_like_success(monkeypatch, capsys) -> None:
    get_settings.cache_clear()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert check_ai.main() == 1
    get_settings.cache_clear()


def test_a_dead_model_exits_non_zero(monkeypatch) -> None:
    """The state that went unnoticed for a month."""
    get_settings.cache_clear()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(check_ai, "ask_for_json", lambda *a, **k: None)
    assert check_ai.main() == 2
    get_settings.cache_clear()


def test_a_working_model_exits_zero(monkeypatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(check_ai, "ask_for_json", lambda *a, **k: {"ok": True})
    assert check_ai.main() == 0
    get_settings.cache_clear()


def test_the_three_states_have_distinct_exit_codes(monkeypatch) -> None:
    """A script checking this must be able to tell them apart."""
    codes = set()
    get_settings.cache_clear()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    codes.add(check_ai.main())
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    get_settings.cache_clear()
    monkeypatch.setattr(check_ai, "ask_for_json", lambda *a, **k: None)
    codes.add(check_ai.main())
    monkeypatch.setattr(check_ai, "ask_for_json", lambda *a, **k: {"ok": True})
    codes.add(check_ai.main())
    assert len(codes) == 3
    get_settings.cache_clear()
