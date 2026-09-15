"""Generate a Gmail filter-import XML: one filter per known ATS domain plus
every employer domain already in the person's own tracked applications,
applying a single `Kall/Job Search` label -- so the ingest job (Phase 2) can
scope its search to `label:kall-job-search`, a much smaller, pre-filtered
set, rather than scanning a whole inbox.

This is the exact format Gmail itself produces from Settings > Filters and
Blocked Addresses > Export, and accepts back on the same screen -- a
one-time manual import the person does themselves, costing nothing beyond
the gmail.readonly scope already requested (creating the filter via the
Gmail API instead would need the broader gmail.settings.basic scope, which
this feature deliberately avoids requesting).
"""

from urllib.parse import urlsplit
from xml.sax.saxutils import escape

from kall.models import Application, Job
from kall.services.ats_web_search import ATS_DOMAINS
from sqlmodel import Session, select

KALL_LABEL = "Kall/Job Search"

_FEED_HEADER = (
    "<?xml version='1.0' encoding='UTF-8'?>\n"
    "<feed xmlns='http://schemas.google.com/g/2005' "
    "xmlns:apps='http://schemas.google.com/apps/2005/GoogleAppsForYourDomain'>\n"
    "<title>Mail Filters</title>\n"
)
_FEED_FOOTER = "</feed>\n"


def _entry(domain: str) -> str:
    query = escape(f"from:({domain})")
    label = escape(KALL_LABEL)
    return (
        "<entry>\n"
        "<category term='filter'></category>\n"
        "<title>Mail Filter</title>\n"
        f"<apps:property name='hasTheWord' value='{query}'/>\n"
        f"<apps:property name='label' value='{label}'/>\n"
        "<apps:property name='shouldArchive' value='false'/>\n"
        "<apps:property name='shouldNeverSpam' value='true'/>\n"
        "</entry>\n"
    )


def tracked_employer_domains(session: Session, user_id: int) -> list[str]:
    """The domain of every job this person has an application against --
    an interview/rejection email almost always comes from the employer's
    own domain, not a generic ATS no-reply address."""
    rows = session.exec(
        select(Job.url).join(Application, Application.job_id == Job.id).where(Application.user_id == user_id).distinct()
    ).all()
    domains: set[str] = set()
    for url in rows:
        host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
        if host:
            domains.add(host)
    return sorted(domains)


def build_gmail_filter_xml(session: Session, user_id: int) -> str:
    domains = sorted({domain for _name, domain in ATS_DOMAINS}) + tracked_employer_domains(session, user_id)
    entries = "".join(_entry(domain) for domain in dict.fromkeys(domains))
    return _FEED_HEADER + entries + _FEED_FOOTER
