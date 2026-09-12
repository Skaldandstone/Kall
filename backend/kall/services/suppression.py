"""User-scoped suppression of job postings that should stop coming back."""

from urllib.parse import urlsplit, urlunsplit

from kall.models import SuppressedResult
from sqlmodel import Session, select

# Dead links and postings flagged as the wrong kind of role entirely (e.g. a
# Mechanical Engineering QA posting under a Software Engineering search) are
# withheld from discovery outright -- re-collecting the same wrong-category
# posting on every future run, even with an industry filter set, is exactly
# what "not relevant" means to stop. A plain "hidden" posting is lighter: the
# person just doesn't want to see this one again, not a signal that it's
# broken or miscategorized, so discovery may keep refreshing it quietly
# underneath -- it is still kept out of every view below.
#
# The "applied" reasons hide a result in the search workspace but must still
# reach the opportunity inbox -- an application in flight is exactly what the
# user wants to keep seeing there.
DISCOVERY_BLOCKING_REASONS = {"dead_link", "not_relevant"}
VALID_REASONS = {"dead_link", "applied_external", "applied_kall", "not_relevant", "hidden"}
#: Reasons that remove a posting from feeds and the opportunity inbox, not
#: just future ingestion. Excludes "applied_*" for the reason above.
VIEW_HIDDEN_REASONS = {"dead_link", "not_relevant", "hidden"}


def normalize_url(url: str) -> str:
    """Collapse the incidental differences between two links to one posting.

    Mirrors the web client's normalization (drop the fragment) and additionally
    lowercases scheme and host, which are case-insensitive per RFC 3986. Query
    strings are kept: job boards routinely identify the posting itself with one
    (`?gh_jid=`), so dropping them would suppress an entire board.
    """
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    if not parts.netloc:
        return url.strip()
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query, ""))


def strip_query(url: str) -> str:
    return url.split("?", 1)[0]


def match_keys(url: str) -> set[str]:
    """Every spelling of `url` a suppression should also cover.

    The two ingestion paths disagree about query strings: a link flagged from
    the Google search workspace keeps its query, while normalize_discovered()
    stores ATS postings with the query stripped. A Greenhouse posting flagged
    as `.../jobs/42?gh_jid=7` would therefore sail straight back in as
    `.../jobs/42`. Matching on both spellings closes that gap.

    The stripped key can in principle over-match two postings that differ only
    by query -- but discovery already collapses those into a single Job row
    (Job.url is unique and query-stripped), so nothing extra is lost.
    """
    normalized = normalize_url(url)
    return {normalized, strip_query(normalized)}


def suppressed_urls(session: Session, user_id: int, *, reasons: set[str] | None = None) -> set[str]:
    statement = select(SuppressedResult.url).where(SuppressedResult.user_id == user_id)
    if reasons is not None:
        statement = statement.where(SuppressedResult.reason.in_(reasons))
    keys: set[str] = set()
    for url in session.exec(statement):
        keys |= match_keys(url)
    return keys


def is_suppressed(url: str, blocked: set[str]) -> bool:
    return bool(match_keys(url) & blocked)
