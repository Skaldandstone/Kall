"""One way to ask OpenAI for a JSON answer.

This existed three times, byte for byte, in growth_ai, onboarding_ai and
api_resume_intelligence -- each ending in a bare `except Exception: return
None`. That silence is the reason this module exists. Every way of failing
looked identical from the outside: no API key configured, a model id OpenAI
does not recognise, an expired key, a rate limit, a timeout. All of them
surfaced to the user as "the AI feature quietly did nothing", and to us as
nothing at all.

The behaviour is unchanged -- callers still get None and still fall back --
but the reason is now written down, which is the difference between a
five-minute fix and an afternoon.
"""

import json
import logging
from typing import Any

import httpx
from kall.config import get_settings

logger = logging.getLogger(__name__)

_ENDPOINT = "https://api.openai.com/v1/responses"
_TIMEOUT = 60


def _extract_text(payload: dict[str, Any]) -> str | None:
    """The Responses API returns output_text at the top level, usually."""
    text = payload.get("output_text")
    if text:
        return text
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return content.get("text")
    return None


def ask_for_json(
    prompt: str,
    *,
    schema_name: str,
    schema: dict[str, Any],
    purpose: str,
) -> dict[str, Any] | None:
    """Ask for a JSON object matching `schema`, or None if anything goes wrong.

    `purpose` names the caller in the logs, so a failing feature is
    identifiable without a stack trace.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        # Expected in development and in tests; not a problem worth warning about.
        logger.debug("%s: no OpenAI key configured, using the fallback", purpose)
        return None

    model = settings.openai_model
    try:
        response = httpx.post(
            _ENDPOINT,
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input": prompt,
                # Career records and resume text are private user data. Kall
                # does not need response retention for these one-shot,
                # structured transformations.
                "store": False,
                # These are constrained extraction and drafting calls. Low
                # reasoning keeps alpha latency and model cost predictable.
                "reasoning": {"effort": "low"},
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": schema_name,
                        "strict": True,
                        "schema": schema,
                    }
                },
            },
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as error:
        logger.warning("%s: could not reach OpenAI (%s)", purpose, error)
        return None

    if response.status_code >= 400:
        # The body carries the actual complaint -- an unknown model id reads
        # "The model `...` does not exist", which is precisely the thing that
        # used to be invisible. Truncated, and the key is never in it.
        logger.warning(
            "%s: OpenAI returned %s for model %r: %s",
            purpose, response.status_code, model, response.text[:400],
        )
        return None

    try:
        text = _extract_text(response.json())
    except ValueError:
        logger.warning("%s: OpenAI returned a body that was not JSON", purpose)
        return None

    if not text:
        logger.warning("%s: OpenAI returned no output text (model %r)", purpose, model)
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # strict json_schema should prevent this; if it happens, the schema or
        # the model is not doing what we think it is.
        logger.warning("%s: OpenAI output was not valid JSON despite the schema", purpose)
        return None
