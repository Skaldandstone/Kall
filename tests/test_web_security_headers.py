from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEXT_CONFIG = ROOT / "apps" / "web" / "next.config.mjs"


def test_csp_allows_the_production_clerk_custom_domain() -> None:
    source = NEXT_CONFIG.read_text(encoding="utf-8")

    assert "https://clerk.kall.skaldandstone.com" in source
    assert "${CLERK_ORIGINS}" in source
