"""Accessible, email-client-safe presentation for Kall notifications."""

from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urljoin

from kall.config import get_settings

_BLOCK_TAGS = {
    "br", "div", "footer", "h1", "h2", "h3", "h4", "li", "p", "table", "tr",
}


def app_url(path: str) -> str:
    """Return an absolute URL on the configured Kall web origin."""
    base = get_settings().frontend_url.rstrip("/") + "/"
    return urljoin(base, path.lstrip("/"))


def action_button(label: str, href: str) -> str:
    """Render a high-contrast CTA that survives restrictive email clients."""
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" border="0" '
        'style="margin:24px 0 8px"><tr><td bgcolor="#d8b66f" '
        'style="border-radius:8px">'
        f'<a href="{escape(href, quote=True)}" style="display:inline-block;padding:14px 22px;'
        'font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:20px;'
        'color:#101721;text-decoration:none;border-radius:8px">'
        f'{escape(label)}</a></td></tr></table>'
    )


def match_card(title: str, company: str, score: int) -> str:
    """Render one compact opportunity row with a prominent match score."""
    return (
        '<tr><td style="padding:14px 16px;border:1px solid #dce3eb;border-radius:8px;'
        'background:#f7f9fb">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'
        '<tr><td style="padding-right:14px;font-family:Arial,sans-serif;color:#152235;'
        'font-size:15px;line-height:22px">'
        f'<strong style="color:#09111d">{escape(title)}</strong><br>'
        f'<span style="color:#5b6878">{escape(company)}</span></td>'
        '<td width="66" align="right" valign="middle" style="font-family:Arial,sans-serif;'
        'color:#8a651f;font-size:17px;font-weight:700;white-space:nowrap">'
        f'{score}%</td></tr></table></td></tr>'
        '<tr><td height="8" style="height:8px;line-height:8px">&nbsp;</td></tr>'
    )


def match_table(rows: list[str]) -> str:
    if not rows:
        return ""
    return (
        '<h2 style="margin:30px 0 14px;font-family:Arial,sans-serif;color:#09111d;'
        'font-size:19px;line-height:26px">Top matches</h2>'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'
        f'{"".join(rows)}</table>'
    )


def render_email_document(subject: str, content_html: str) -> str:
    """Wrap trusted notification markup in Kall's responsive email chrome."""
    title = subject.removeprefix("Kall: ")
    logo_url = app_url("/icon-192.png")
    preferences_url = app_url("/settings/notifications")
    preheader = re.sub(r"\s+", " ", html_to_text(content_html)).strip()[:140]
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{escape(subject)}</title>
  <style>
    @media only screen and (max-width:620px) {{
      .email-shell {{ width:100% !important; }}
      .email-pad {{ padding-left:20px !important; padding-right:20px !important; }}
    }}
    @media (prefers-color-scheme:dark) {{
      .email-page {{ background:#09111d !important; }}
      .email-card {{ background:#111c2b !important; border-color:#25364c !important; }}
      .email-copy, .email-copy p, .email-copy li {{ color:#d7dee8 !important; }}
      .email-title, .email-copy h2, .email-copy h3, .email-copy strong {{ color:#f4f1e9 !important; }}
      .email-footer {{ color:#aab7c8 !important; }}
    }}
  </style>
</head>
<body class="email-page" style="margin:0;padding:0;background:#eef1f5;word-spacing:normal">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{escape(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef1f5">
    <tr><td align="center" style="padding:28px 12px">
      <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%">
        <tr><td class="email-pad" style="padding:0 32px 18px">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td><img src="{escape(logo_url, quote=True)}" width="44" height="44" alt="" style="display:block;border:0;border-radius:11px"></td>
            <td style="padding-left:12px;font-family:Arial,sans-serif;color:#09111d;font-size:23px;font-weight:700;letter-spacing:-0.5px">Kall</td>
          </tr></table>
        </td></tr>
        <tr><td class="email-card email-pad" style="padding:36px 40px;background:#ffffff;border:1px solid #dce3eb;border-radius:14px">
          <div style="width:46px;height:4px;margin-bottom:22px;background:#d8b66f;border-radius:2px"></div>
          <h1 class="email-title" style="margin:0 0 18px;font-family:Georgia,serif;color:#09111d;font-size:28px;line-height:36px;font-weight:400">{escape(title)}</h1>
          <div class="email-copy" style="font-family:Arial,sans-serif;color:#3f4d5f;font-size:16px;line-height:25px">{content_html}</div>
        </td></tr>
        <tr><td class="email-footer email-pad" style="padding:20px 32px 0;font-family:Arial,sans-serif;color:#667486;font-size:12px;line-height:19px">
          Kall is your career workspace from Skald &amp; Stone.<br>
          <a href="{escape(preferences_url, quote=True)}" style="color:#50667f;text-decoration:underline">Manage notification preferences</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>'''


class _PlainTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "a":
            self.hrefs.append(dict(attrs).get("href") or "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.hrefs:
            href = self.hrefs.pop()
            if href:
                self.parts.append(f" ({href})")
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def html_to_text(value: str) -> str:
    """Produce a readable MIME text alternative without retaining markup."""
    parser = _PlainTextParser()
    parser.feed(value)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in "".join(parser.parts).splitlines()]
    return "\n".join(line for line in lines if line).strip()
