"""Architecture checks for the product-owned generated-content boundary."""

import ast
from pathlib import Path

from kall.services import openai_json

BACKEND = Path(__file__).parents[1] / "backend" / "kall"


def test_every_product_openai_call_uses_the_owned_adapter_and_source_reference() -> None:
    direct_endpoints: list[str] = []
    missing_sources: list[str] = []
    for path in BACKEND.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        if "api.openai.com" in source and path.name != "openai_json.py":
            direct_endpoints.append(str(path.relative_to(BACKEND)))
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = node.func.id if isinstance(node.func, ast.Name) else None
            if name != "ask_for_json":
                continue
            keywords = {keyword.arg for keyword in node.keywords}
            if "source_ref" not in keywords:
                missing_sources.append(f"{path.relative_to(BACKEND)}:{node.lineno}")
    assert direct_endpoints == []
    assert missing_sources == []


def test_runtime_instruction_contains_the_nonnegotiable_boundaries() -> None:
    instruction = openai_json.KALL_DEVELOPER_INSTRUCTIONS.casefold()
    for phrase in (
        "never invent facts",
        "keep unknowns visible",
        "accountable person must review",
        "untrusted data",
        "cannot override this developer instruction",
        "follow the supplied json schema exactly",
    ):
        assert phrase in instruction
