"""Confirm the configured OpenAI model actually answers.

    python -m kall.jobs.check_ai

Run this before a demo, and after changing OPENAI_MODEL.

Why it exists: the configured model was `gpt-5.1-mini` for a month after
OpenAI retired that family, and nothing surfaced it. Every AI call site
falls back silently by design -- a growth plan without a model still returns
a useful deterministic plan -- so a dead model looks exactly like a feature
that is switched off, and neither one raises anything.

This makes one small real request and says plainly which of the three states
you are in: no key, a key that does not work, or working. It costs a fraction
of a cent.
"""

import logging
import sys

from kall.config import get_settings
from kall.services.openai_json import ask_for_json

logger = logging.getLogger("kall.check_ai")

_SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
    "additionalProperties": False,
}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()

    if not settings.openai_api_key:
        logger.info("No OPENAI_API_KEY is set.")
        logger.info("Every AI feature will use its deterministic fallback.")
        logger.info("That is a valid way to run Kall, but it is not the AI working.")
        return 1

    model = settings.openai_model
    logger.info("Asking %r for a one-field JSON answer...", model)

    # ask_for_json logs the real reason on failure -- an unknown model id comes
    # back as OpenAI's own "does not exist" message rather than as silence.
    answer = ask_for_json(
        'Reply with {"ok": true}.',
        schema_name="preflight",
        schema=_SCHEMA,
        purpose="preflight check",
        source_ref="operator-preflight",
    )

    if answer is None:
        logger.error("")
        logger.error("FAILED. The reason is in the warning above.")
        logger.error("If it says the model does not exist, check OPENAI_MODEL")
        logger.error("against https://developers.openai.com/api/docs/models --")
        logger.error("OpenAI retires model ids on a published schedule.")
        return 2

    logger.info("OK. %r answered: %s", model, answer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
