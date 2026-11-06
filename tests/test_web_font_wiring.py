from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"


def test_web_fonts_are_bundled_without_google_build_fetches() -> None:
    root_layout = (WEB / "app" / "layout.tsx").read_text()
    career_layout = (WEB / "app" / "p" / "[slug]" / "layout.tsx").read_text()
    package = (WEB / "package.json").read_text()

    assert "next/font/google" not in root_layout
    assert "next/font/google" not in career_layout
    for dependency in (
        "@fontsource-variable/cormorant-garamond",
        "@fontsource-variable/epilogue",
        "@fontsource-variable/fraunces",
        "@fontsource-variable/ibm-plex-sans",
        "@fontsource-variable/syne",
        "@fontsource/ibm-plex-mono",
    ):
        assert dependency in package
        assert dependency in root_layout or dependency in career_layout


def test_web_font_variables_keep_the_established_families() -> None:
    css = (WEB / "app" / "globals.css").read_text()

    for family in (
        '"Cormorant Garamond Variable"',
        '"Epilogue Variable"',
        '"Fraunces Variable"',
        '"IBM Plex Sans Variable"',
        '"Syne Variable"',
        '"IBM Plex Mono"',
    ):
        assert family in css
