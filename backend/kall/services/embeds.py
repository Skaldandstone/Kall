"""Work samples on a public career page.

A portfolio needs to show the work, not describe it. The rule here is that
Kall never hosts it: the user points at something already published --
a demo video, a prototype, a pen -- and the page embeds it. The career page is
public, so an upload would mean egress that scales with viewers rather than
with the account, and a file store full of strangers' media.

**The security model is the point of this module.** A career page is public
HTML with a user-supplied URL in it, which is the classic shape of a stored
injection. Two rules keep it safe, and both matter:

1. *Nothing is embedded that we cannot name.* A URL is matched against a
   provider allowlist and reduced to an opaque id. There is no generic iframe
   fallback -- an unrecognised link renders as a link, never a frame.
2. *The raw URL never reaches the markup.* The renderer builds the embed URL
   itself from the provider template and the extracted id, so a `javascript:`
   or `data:` URL has nowhere to land even if one were stored.

Adding a provider means adding a pattern and a template here, and adding the
frame origin to the career page's Content-Security-Policy in
apps/web/next.config.mjs. Both, or the embed silently shows an empty box.
"""

import re
from dataclasses import dataclass
from urllib.parse import quote, urlparse


@dataclass(frozen=True)
class Provider:
    name: str
    #: Patterns tried in order against the URL. The first group is the id.
    patterns: tuple[re.Pattern[str], ...]
    #: Where the id is substituted to build the frame source.
    template: str
    #: Shown while the frame loads and to anyone who cannot see it.
    label: str
    #: Height as a percentage of width, so embeds keep their shape.
    aspect_ratio: float = 56.25


def _compile(*patterns: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns)


PROVIDERS: tuple[Provider, ...] = (
    Provider(
        name="youtube",
        patterns=_compile(
            r"^https?://(?:www\.)?youtube\.com/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})",
            r"^https?://(?:www\.)?youtube\.com/embed/([A-Za-z0-9_-]{11})",
            r"^https?://youtu\.be/([A-Za-z0-9_-]{11})",
        ),
        # -nocookie so a visitor to someone's career page is not tracked by
        # Google for having looked at it.
        template="https://www.youtube-nocookie.com/embed/{id}",
        label="YouTube video",
    ),
    Provider(
        name="vimeo",
        patterns=_compile(r"^https?://(?:www\.)?vimeo\.com/(\d+)"),
        template="https://player.vimeo.com/video/{id}",
        label="Vimeo video",
    ),
    Provider(
        name="loom",
        patterns=_compile(r"^https?://(?:www\.)?loom\.com/(?:share|embed)/([0-9a-f]{32})"),
        template="https://www.loom.com/embed/{id}",
        label="Loom recording",
    ),
    Provider(
        name="codepen",
        patterns=_compile(r"^https?://(?:www\.)?codepen\.io/([A-Za-z0-9_-]{1,40}/pen/[A-Za-z0-9]{1,20})"),
        template="https://codepen.io/{id}",
        label="CodePen",
        aspect_ratio=75.0,
    ),
    Provider(
        name="figma",
        # Figma embeds the original URL rather than an id, so the whole path is
        # the "id" -- still reconstructed by us, and still only from figma.com.
        patterns=_compile(r"^https?://(?:www\.)?figma\.com/((?:file|design|proto|board)/[A-Za-z0-9]{10,40}(?:/[^\s?#]*)?)"),
        template="https://www.figma.com/embed?embed_host=kall&url=https://www.figma.com/{id}",
        label="Figma file",
        aspect_ratio=75.0,
    ),
)

#: Frame origins the providers above actually load from. The career page CSP
#: must list exactly these; kept here so the two cannot drift silently apart.
EMBED_FRAME_ORIGINS: tuple[str, ...] = (
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
    "https://www.loom.com",
    "https://codepen.io",
    "https://www.figma.com",
)

MAX_EMBEDS_PER_SECTION = 12
_MAX_TITLE = 120
_MAX_CAPTION = 400


class InvalidEmbed(ValueError):
    """The URL is not something that can go on a public page."""


def _safe_link(url: str) -> str:
    """An http(s) URL, or nothing.

    The fallback for an unrecognised provider is a link, and a link is still a
    place a `javascript:` URL could live.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise InvalidEmbed("Only http and https links can go on a public page.")
    return url


def parse_embed(url: str, *, title: str = "", caption: str = "") -> dict[str, object]:
    """Reduce a user-supplied URL to something safe to render.

    Returns a recognised embed, or a plain link when no provider matches.
    Raises InvalidEmbed only when the URL cannot be shown at all.
    """
    url = (url or "").strip()
    if not url:
        raise InvalidEmbed("A work sample needs a link.")
    if len(url) > 2000:
        raise InvalidEmbed("That link is too long.")

    record: dict[str, object] = {
        "title": (title or "").strip()[:_MAX_TITLE],
        "caption": (caption or "").strip()[:_MAX_CAPTION],
    }

    for provider in PROVIDERS:
        for pattern in provider.patterns:
            match = pattern.match(url)
            if not match:
                continue
            identifier = match.group(1)
            return {
                **record,
                "provider": provider.name,
                "embed_id": identifier,
                # Kept for the "open the original" link and for re-parsing if
                # a provider's embed URL ever changes shape.
                "url": _safe_link(url),
                "kind": "embed",
            }

    # Not a provider we know. A link, deliberately -- never a guessed iframe.
    return {**record, "provider": "link", "embed_id": "", "url": _safe_link(url), "kind": "link"}


def embed_frame_url(record: dict[str, object]) -> str | None:
    """The frame source for a stored embed, built from the template.

    None for a plain link. The stored URL is never used as a frame source.
    """
    provider = next((p for p in PROVIDERS if p.name == record.get("provider")), None)
    if provider is None:
        return None
    identifier = str(record.get("embed_id") or "")
    if not identifier:
        return None
    # Re-validated on the way out as well as on the way in: a row edited
    # directly in the database, or written before a pattern was tightened,
    # must not become a frame we did not intend.
    if not re.fullmatch(r"[A-Za-z0-9_\-/]{1,200}", identifier):
        return None
    return provider.template.format(id=quote(identifier, safe="/-_"))


def provider_for(name: str) -> Provider | None:
    return next((p for p in PROVIDERS if p.name == name), None)


def normalize_samples(raw: list[dict[str, object]] | None) -> list[dict[str, object]]:
    """Validate a whole section's worth of work samples."""
    items = raw or []
    if len(items) > MAX_EMBEDS_PER_SECTION:
        raise InvalidEmbed(f"A section can hold at most {MAX_EMBEDS_PER_SECTION} work samples.")
    return [
        parse_embed(
            str(item.get("url", "")),
            title=str(item.get("title", "")),
            caption=str(item.get("caption", "")),
        )
        for item in items
    ]
