"""Asking OpenAI for JSON, and saying so when it does not work.

Every one of these used to be the same observable outcome -- None, silently.
The assertions here are as much about the log line as the return value: the
log is the only thing that distinguishes "no key configured" from "the model
id in config does not exist".
"""

import json
import logging

import httpx
import pytest
from kall.config import get_settings
from kall.services import openai_json


class FakeResponse:
    def __init__(self, status_code: int, body, text: str = "") -> None:
        self.status_code = status_code
        self._body = body
        self.text = text or json.dumps(body)

    def json(self):
        if self._body is None:
            raise ValueError("not JSON")
        return self._body


SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}


def ask():
    return openai_json.ask_for_json(
        "hello", schema_name="thing", schema=SCHEMA, purpose="a feature"
    )


@pytest.fixture
def with_key(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
    yield
    get_settings.cache_clear()


def test_no_key_is_quiet(monkeypatch, caplog):
    """Expected in development; it must not look like a fault."""
    get_settings.cache_clear()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with caplog.at_level(logging.WARNING):
        assert ask() is None
    assert caplog.records == []
    get_settings.cache_clear()


def test_an_unknown_model_says_so(with_key, monkeypatch, caplog):
    """The case this module was written for.

    A model id that OpenAI does not recognise used to be indistinguishable
    from the feature being switched off.
    """
    monkeypatch.setattr(
        httpx, "post",
        lambda *a, **k: FakeResponse(404, {"error": {"message": "The model `gpt-x` does not exist"}}),
    )
    with caplog.at_level(logging.WARNING):
        assert ask() is None
    logged = caplog.text
    assert "404" in logged
    assert "does not exist" in logged, "the reason must reach the log"
    assert "a feature" in logged, "the caller must be identifiable"


def test_the_key_is_never_logged(with_key, monkeypatch, caplog):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResponse(401, {"error": "bad key"}))
    with caplog.at_level(logging.WARNING):
        ask()
    assert "sk-test-not-a-real-key" not in caplog.text


def test_a_network_failure_is_reported_not_raised(with_key, monkeypatch, caplog):
    def boom(*a, **k):
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(httpx, "post", boom)
    with caplog.at_level(logging.WARNING):
        assert ask() is None
    assert "could not reach OpenAI" in caplog.text


def test_a_good_answer_comes_back_parsed(with_key, monkeypatch):
    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: FakeResponse(200, {"output_text": '{"ok": true}'})
    )
    assert ask() == {"ok": True}


def test_output_text_is_found_in_the_nested_shape(with_key, monkeypatch):
    """The Responses API does not always put it at the top level."""
    monkeypatch.setattr(
        httpx, "post",
        lambda *a, **k: FakeResponse(
            200,
            {"output": [{"content": [{"type": "output_text", "text": '{"ok": false}'}]}]},
        ),
    )
    assert ask() == {"ok": False}


def test_unparseable_output_is_reported(with_key, monkeypatch, caplog):
    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: FakeResponse(200, {"output_text": "not json at all"})
    )
    with caplog.at_level(logging.WARNING):
        assert ask() is None
    assert "not valid JSON" in caplog.text
