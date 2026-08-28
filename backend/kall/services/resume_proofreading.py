"""Job-independent resume quality checks.

Not a spelling checker -- that needs a dictionary or a network call, neither
of which this adds. What's achievable without one, and what a resume score
that only checked metadata completeness (has text, tags, target titles) was
missing entirely: a duplicated line (a stray copy-paste, most often a
repeated bullet or the same line appearing in two jobs by accident), and the
kind of long unspaced run of text a multi-column PDF layout produces once an
extractor reads across columns instead of down one -- the exact failure mode
that also breaks an ATS parser, not just a person's eye.
"""

import re
from collections import Counter

_MIN_LINE_LENGTH_TO_FLAG = 25
_LONG_UNSPACED_RUN = 40
_WORDS_PER_PAGE_ESTIMATE = 600
_MAX_REASONABLE_PAGES = 2.2


def find_repeated_lines(text: str) -> list[str]:
    """Lines of at least _MIN_LINE_LENGTH_TO_FLAG characters that appear more
    than once verbatim. Short lines (section headers, dates) are excluded --
    those repeat by design and are not a sign of anything wrong.
    """
    lines = [line.strip() for line in text.splitlines() if len(line.strip()) >= _MIN_LINE_LENGTH_TO_FLAG]
    counts = Counter(lines)
    return [line for line, count in counts.items() if count > 1]


def find_unspaced_runs(text: str) -> list[str]:
    """Runs of _LONG_UNSPACED_RUN+ non-whitespace characters."""
    return [match.group(0) for match in re.finditer(rf"\S{{{_LONG_UNSPACED_RUN},}}", text)]


def estimated_page_count(text: str) -> float:
    words = len(text.split())
    return words / _WORDS_PER_PAGE_ESTIMATE if words else 0.0


def proofreading_gaps(text: str) -> list[str]:
    """Human-readable gap strings, in the same shape _resume_score's other
    gaps already use -- so this folds into the existing "Next improvements"
    list rather than needing a new UI surface.
    """
    gaps: list[str] = []

    repeated = find_repeated_lines(text)
    if repeated:
        preview = repeated[0] if len(repeated[0]) <= 80 else f"{repeated[0][:77]}..."
        gaps.append(f'A line appears more than once -- check for an accidental duplicate: "{preview}"')

    if find_unspaced_runs(text):
        gaps.append(
            "Found a long stretch of text with no spaces, which usually means a multi-column "
            "layout merged two columns into one line -- the same thing an ATS parser will do. "
            "A single-column layout avoids this."
        )

    pages = estimated_page_count(text)
    if pages > _MAX_REASONABLE_PAGES:
        gaps.append(f"About {pages:.0f} pages of text -- most roles expect one to two pages.")

    return gaps
