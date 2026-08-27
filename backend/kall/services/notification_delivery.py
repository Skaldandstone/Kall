"""Draining the notification outbox: NotificationDelivery rows to sent email
or push.

The outbox and its producer (`opportunities.queue_digest`) already existed.
What did not exist was anything that read a `status="queued"` row and did
something with it -- this is that.

**Deduplication is enforced here, not by the schema.** `dedupe_key` is
indexed but not unique, so nothing stops two calls to `queue_digest` in the
same day from inserting two rows with the same key. Before sending, this
checks whether another delivery with the same key already reached "sent" and
skips if so -- the alternative is a person getting the same digest email
twice because a retry or a race queued it a second time.

**Preferences are re-checked at send time, not just at queue time.** Someone
can turn off email between when a digest was queued and when this runs; an
opted-out channel is skipped and marked accordingly rather than sent anyway.

**Quiet hours delay rather than drop.** A delivery that lands inside someone's
quiet hours is rescheduled to when they end, not silently discarded -- it is
still something they asked to see, just not right now.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from kall.models.core import Job, User
from kall.models.opportunities import NotificationDelivery, NotificationPreference, Opportunity
from kall.services.notifications import NotConfiguredError, NotificationService
from sqlmodel import Session, select

logger = logging.getLogger(__name__)

#: How long a pending delivery waits before the next retry, doubling each
#: time. Capped rather than unbounded so a persistent failure (bad address,
#: provider outage) does not retry for weeks.
_BACKOFF_MINUTES = (5, 30, 120, 720)
_MAX_ATTEMPTS = len(_BACKOFF_MINUTES)


def _in_quiet_hours(preference: NotificationPreference, now: datetime) -> bool:
    if preference.quiet_hours_start is None or preference.quiet_hours_end is None:
        return False
    local = now.time()
    start, end = preference.quiet_hours_start, preference.quiet_hours_end
    if start <= end:
        return start <= local < end
    return local >= start or local < end  # a window crossing midnight


def _reschedule_past_quiet_hours(preference: NotificationPreference, now: datetime) -> datetime:
    target = preference.quiet_hours_end
    candidate = datetime.combine(now.date(), target)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def _already_sent(session: Session, dedupe_key: str, exclude_id: int) -> bool:
    return session.exec(
        select(NotificationDelivery).where(
            NotificationDelivery.dedupe_key == dedupe_key,
            NotificationDelivery.status == "sent",
            NotificationDelivery.id != exclude_id,
        )
    ).first() is not None


def _digest_email(session: Session, delivery: NotificationDelivery) -> tuple[str, str]:
    """(subject, html) for an opportunity_digest delivery."""
    ids = delivery.payload.get("opportunity_ids", [])
    opportunities = list(
        session.exec(select(Opportunity).where(Opportunity.id.in_(ids)))
    ) if ids else []
    jobs_by_id = {
        job.id: job
        for job in session.exec(
            select(Job).where(Job.id.in_([o.job_id for o in opportunities]))
        )
    } if opportunities else {}

    rows = []
    for opportunity in opportunities:
        job = jobs_by_id.get(opportunity.job_id)
        if not job:
            continue
        rows.append(
            f"<li><strong>{job.title}</strong> at {job.company} "
            f"&mdash; {opportunity.match_score}% match</li>"
        )
    subject = f"{len(rows)} new opportunit{'y' if len(rows) == 1 else 'ies'} today"
    html = f"<p>Kall found {len(rows)} new match{'es' if len(rows) != 1 else ''} for you.</p><ul>{''.join(rows)}</ul>"
    return subject, html


def _morning_brief_email(session: Session, delivery: NotificationDelivery) -> tuple[str, str]:
    from kall.models.core import User
    from kall.services.brief import build_morning_brief

    user = session.get(User, delivery.user_id)
    brief = build_morning_brief(session, user)
    focus = brief["focus"]
    subject = f"Kall: {focus['title']}"

    rows = "".join(
        f"<li><strong>{item['title']}</strong> at {item['company']} &mdash; {item['score']}% match</li>"
        for item in brief["opportunities"][:3]
    )
    html = (
        f"<p>{focus['detail']}</p>"
        f"<p><a href=\"{focus['href']}\">Open it</a></p>"
        + (f"<h3>Top matches</h3><ul>{rows}</ul>" if rows else "")
        + f"<p>Career health: {brief['career_health']['score']}%</p>"
    )
    return subject, html


def _payment_grace_period_expired_email(delivery: NotificationDelivery) -> tuple[str, str]:
    del delivery
    subject = "Your Kall plan has been paused"
    html = (
        "<p>We were unable to charge your card for three days, so your account "
        "has moved to the Free plan. Update your payment method and re-subscribe "
        "any time from Billing.</p>"
    )
    return subject, html


def _render(session: Session, delivery: NotificationDelivery) -> tuple[str, str]:
    if delivery.kind == "opportunity_digest":
        return _digest_email(session, delivery)
    if delivery.kind == "payment_grace_period_expired":
        return _payment_grace_period_expired_email(delivery)
    if delivery.kind == "morning_brief":
        return _morning_brief_email(session, delivery)
    raise ValueError(f"Unknown notification kind: {delivery.kind}")


def queue(
    session: Session,
    *,
    user_id: int,
    kind: str,
    payload: dict | None = None,
    channel: str = "email",
    dedupe_key: str | None = None,
) -> NotificationDelivery:
    """Add one row to the outbox. Generic across notification kinds.

    dedupe_key defaults to one delivery per (user, kind) per calendar day --
    the same shape opportunities.queue_digest already used for digests, just
    not hard-coded to that one kind.
    """
    key = dedupe_key or f"{kind}:{user_id}:{datetime.utcnow().date().isoformat()}"
    delivery = NotificationDelivery(
        user_id=user_id, channel=channel, kind=kind, dedupe_key=key, payload=payload or {},
    )
    session.add(delivery)
    session.commit()
    session.refresh(delivery)
    return delivery


def _fail_or_retry(session: Session, delivery: NotificationDelivery, reason: str, now: datetime) -> None:
    delivery.attempts += 1
    delivery.last_error = reason
    if delivery.attempts >= _MAX_ATTEMPTS:
        delivery.status = "failed"
        delivery.next_attempt_at = None
    else:
        delivery.status = "retrying"
        delivery.next_attempt_at = now + timedelta(minutes=_BACKOFF_MINUTES[delivery.attempts - 1])
    session.add(delivery)
    session.commit()


def process_delivery(session: Session, delivery: NotificationDelivery, now: datetime | None = None) -> str:
    """Attempt one delivery. Returns the resulting status.

    Never raises for an expected outcome (not configured, opted out, no
    matching preference, quiet hours) -- those are all valid resting states
    for a row, not errors in this function. A send failure from the provider
    itself is caught and turned into a retry or a terminal failure, so a
    single bad row cannot crash the whole drain run.
    """
    now = now or datetime.utcnow()

    if _already_sent(session, delivery.dedupe_key, delivery.id):
        delivery.status = "duplicate"
        session.add(delivery)
        session.commit()
        return delivery.status

    user = session.get(User, delivery.user_id)
    if user is None:
        # The account was deleted after this was queued. Not an error --
        # there is simply nobody left to notify.
        delivery.status = "skipped"
        session.add(delivery)
        session.commit()
        return delivery.status

    preference = session.exec(
        select(NotificationPreference).where(NotificationPreference.user_id == delivery.user_id)
    ).first()
    channel_enabled = True
    if preference:
        channel_enabled = preference.email_enabled if delivery.channel == "email" else preference.push_enabled
        if channel_enabled and _in_quiet_hours(preference, now):
            delivery.status = "retrying"
            delivery.next_attempt_at = _reschedule_past_quiet_hours(preference, now)
            session.add(delivery)
            session.commit()
            return delivery.status

    if not channel_enabled:
        delivery.status = "skipped"
        session.add(delivery)
        session.commit()
        return delivery.status

    try:
        subject, html = _render(session, delivery)
    except ValueError as error:
        logger.warning("Cannot render delivery %s: %s", delivery.id, error)
        delivery.status = "failed"
        delivery.last_error = str(error)
        session.add(delivery)
        session.commit()
        return delivery.status

    service = NotificationService()
    try:
        if delivery.channel == "email":
            service.send_email(user.email, subject, html, actions=[])
        else:
            service.send_push(user.id, subject, html, actions=[])
    except NotConfiguredError as error:
        # Distinct from a send failure: nobody could have received this
        # regardless of retrying, so it is left queued rather than burning
        # through its retry budget against a channel that will never work
        # until someone configures it.
        logger.info("Delivery %s not sent (%s): %s", delivery.id, delivery.channel, error)
        return delivery.status
    except Exception as error:  # noqa: BLE001 - any provider failure lands here
        logger.warning("Delivery %s failed: %s", delivery.id, error, exc_info=True)
        _fail_or_retry(session, delivery, str(error), now)
        return delivery.status

    delivery.status = "sent"
    delivery.delivered_at = now
    session.add(delivery)
    session.commit()
    return delivery.status


def drain(session: Session, *, now: datetime | None = None, limit: int = 500) -> dict[str, int]:
    """Process every delivery that is due. Returns counts by resulting status."""
    now = now or datetime.utcnow()
    due = session.exec(
        select(NotificationDelivery)
        .where(NotificationDelivery.status.in_(["queued", "retrying"]))
        .where(
            (NotificationDelivery.next_attempt_at.is_(None))
            | (NotificationDelivery.next_attempt_at <= now)
        )
        .limit(limit)
    ).all()

    counts: dict[str, int] = {}
    for delivery in due:
        status = process_delivery(session, delivery, now=now)
        counts[status] = counts.get(status, 0) + 1
    return counts


#: Defaults used for anyone with no NotificationPreference row at all --
#: there is no settings UI for this yet, so most accounts have none. Treated
#: as "use these defaults" rather than "excluded": email_enabled defaults to
#: True on the model itself, which only means something if the absence of a
#: row is read the same way.
_DEFAULT_DIGEST_HOUR = 8
_DEFAULT_TIMEZONE = "UTC"


def _local_hour(timezone_name: str, now: datetime) -> int:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        # A stored value that no longer resolves (typo, renamed IANA zone)
        # should not crash the whole run over one account -- fall back to UTC
        # for that account rather than skipping every user after it.
        zone = ZoneInfo(_DEFAULT_TIMEZONE)
    return now.replace(tzinfo=UTC).astimezone(zone).hour


def queue_daily_briefs(session: Session, *, now: datetime | None = None) -> int:
    """Queue a morning_brief delivery for every account whose local hour
    matches their preferred digest hour right now.

    Meant to be called roughly once an hour (jobs/daily_brief.py); calling it
    more than once inside the matching hour queues duplicate rows, but that is
    harmless -- drain()'s own dedupe_key check (see _already_sent) only ever
    lets one of them actually send. Returns the number queued.
    """
    now = now or datetime.utcnow()
    rows = session.exec(
        select(User, NotificationPreference)
        .join(NotificationPreference, NotificationPreference.user_id == User.id, isouter=True)
        .where(User.is_active.is_(True))
    ).all()

    queued = 0
    for user, preference in rows:
        email_enabled = preference.email_enabled if preference else True
        digest_hour = preference.digest_hour_local if preference else _DEFAULT_DIGEST_HOUR
        timezone_name = preference.timezone if preference else _DEFAULT_TIMEZONE
        if not email_enabled:
            continue
        if _local_hour(timezone_name, now) != digest_hour:
            continue
        queue(session, user_id=user.id, kind="morning_brief")
        queued += 1
    return queued
