"""Work-sample embeds on a public career page.

A user-supplied URL rendered into public HTML is the classic stored-injection
shape, so most of this file is about what must NOT become a frame.
"""

import pytest
from kall.services.embeds import (
    EMBED_FRAME_ORIGINS,
    MAX_EMBEDS_PER_SECTION,
    PROVIDERS,
    InvalidEmbed,
    embed_frame_url,
    normalize_samples,
    parse_embed,
)


@pytest.mark.parametrize(
    ("url", "provider", "identifier"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
        ("https://vimeo.com/123456789", "vimeo", "123456789"),
        ("https://www.loom.com/share/" + "a" * 32, "loom", "a" * 32),
        ("https://codepen.io/someone/pen/abcXYZ", "codepen", "someone/pen/abcXYZ"),
        ("https://www.figma.com/design/ABCdef1234/My-File", "figma", "design/ABCdef1234/My-File"),
    ],
)
def test_known_providers_are_recognised(url: str, provider: str, identifier: str) -> None:
    record = parse_embed(url)
    assert record["provider"] == provider
    assert record["embed_id"] == identifier
    assert record["kind"] == "embed"


def test_the_frame_url_is_built_from_the_template_not_the_input() -> None:
    """The stored URL must never be what the browser loads."""
    record = parse_embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    frame = embed_frame_url(record)
    assert frame == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    assert "watch?v=" not in frame


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        "vbscript:msgbox(1)",
        "file:///etc/passwd",
        "  javascript:alert(1)",
    ],
)
def test_dangerous_schemes_are_refused_outright(url: str) -> None:
    with pytest.raises(InvalidEmbed):
        parse_embed(url)


@pytest.mark.parametrize(
    "url",
    [
        # Look-alike hosts that must not be taken for the real provider.
        "https://youtube.com.attacker.net/watch?v=dQw4w9WgXcQ",
        "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
        "https://evil.com/https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://vimeo.com.evil.net/123456789",
        "https://figma.com.evil.net/design/ABCdef1234/x",
    ],
)
def test_lookalike_hosts_do_not_become_frames(url: str) -> None:
    record = parse_embed(url)
    assert record["kind"] == "link", "a look-alike host must never be framed"
    assert embed_frame_url(record) is None


def test_an_unknown_but_harmless_url_becomes_a_link_not_a_frame() -> None:
    record = parse_embed("https://example.com/my-portfolio")
    assert record["kind"] == "link"
    assert record["provider"] == "link"
    # This is the rule that matters: no generic iframe fallback exists.
    assert embed_frame_url(record) is None


def test_titles_and_captions_are_bounded() -> None:
    record = parse_embed(
        "https://vimeo.com/1", title="t" * 500, caption="c" * 5000
    )
    assert len(record["title"]) <= 120
    assert len(record["caption"]) <= 400


def test_a_section_cannot_hold_unlimited_samples() -> None:
    too_many = [{"url": "https://vimeo.com/1"}] * (MAX_EMBEDS_PER_SECTION + 1)
    with pytest.raises(InvalidEmbed):
        normalize_samples(too_many)


def test_a_tampered_identifier_does_not_escape_the_template() -> None:
    """Defence for a row edited outside the API."""
    for bad in ["../../evil", "a b", "x?y=z", "x#frag", 'x"onload=alert(1)', "x'>"]:
        assert embed_frame_url({"provider": "youtube", "embed_id": bad}) is None


def test_every_provider_origin_is_declared() -> None:
    """The CSP list and the templates must not drift apart.

    A provider whose origin is missing from the career page CSP renders as an
    empty box with only a console warning, which is a miserable thing to debug.
    """
    for provider in PROVIDERS:
        assert any(provider.template.startswith(origin) for origin in EMBED_FRAME_ORIGINS), (
            f"{provider.name} frames from an origin the CSP does not allow"
        )


def test_normalize_passes_through_a_realistic_mix() -> None:
    samples = normalize_samples([
        {"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Launch demo"},
        {"url": "https://example.com/case-study.pdf", "title": "Case study"},
    ])
    assert [item["kind"] for item in samples] == ["embed", "link"]
