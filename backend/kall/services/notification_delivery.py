"""Durable outbox delivery with consent checks, atomic leases and explicit outcomes.

Opportunity events coalesce into a single pending summary per user. A send is
persisted before contacting the provider. Definite rejections retry with bounded
backoff; a lost response or expired sending claim requires reconciliation.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from html import escape

from kall.clock import utcnow
from kall.models.core import Job, User
from kall.models.opportunities import NotificationDelivery, NotificationPreference
from kall.services import work_claims
from kall.services.notification_timing import (
    after_quiet_hours,
    as_local,
    digest_ready,
    in_quiet_hours,
    next_digest,
)
from kall.services.notifications import (
    NotConfiguredError,
    NotificationService,
    PermanentDeliveryError,
    RetryableDeliveryError,
)
from kall.services.opportunity_notifications import (
    OPPORTUNITY_KINDS,
    eligible_opportunities,
    eligible_source_opportunities,
    finish_events,
    preference_for,
    prepare_deliveries,
)
from kall.services.scheduling import local_hour
from sqlmodel import Session, select

logger = logging.getLogger(__name__)

#: How long a pending delivery waits before the next retry, doubling each
#: time. Capped rather than unbounded so a persistent failure (bad address,
#: provider outage) does not retry for weeks.
_BACKOFF_MINUTES = (5, 30, 120, 720)
_MAX_ATTEMPTS = len(_BACKOFF_MINUTES)


def _in_quiet_hours(preference: NotificationPreference, now: datetime) -> bool:
    return in_quiet_hours(preference, now)


def _reschedule_past_quiet_hours(preference: NotificationPreference, now: datetime) -> datetime:
    return after_quiet_hours(preference, now)


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
    opportunities = eligible_opportunities(session, delivery.user_id, opportunity_ids=ids) if ids else []
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
            f"<li><strong>{escape(job.title)}</strong> at {escape(job.company)}: "
            f"{opportunity.match_score}% match</li>"
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


def _certification_renewal_email(delivery: NotificationDelivery) -> tuple[str, str]:
    payload = delivery.payload
    subject = f"Renewal reminder: {payload['name']}"
    html = (
        f"<p>Your <strong>{payload['name']}</strong> from {payload['issuing_organization']} "
        f"expires on {payload['expires_on']}.</p>"
        "<p>Update it in your Kall profile once it's renewed, or before if you'd rather get ahead of it.</p>"
    )
    return subject, html


def _growth_milestone_reminder_email(delivery: NotificationDelivery) -> tuple[str, str]:
    payload = delivery.payload
    subject = f"Coming up: {payload['title']}"
    html = (
        f"<p>Your <strong>{payload['title']}</strong> milestone ({payload['phase']}) "
        f"is targeted for {payload['target_date']}.</p>"
        "<p>Check in on your growth plan in Kall to see how it's going.</p>"
    )
    return subject, html


def _work_authorization_reminder_email(delivery: NotificationDelivery) -> tuple[str, str]:
    payload = delivery.payload
    subject = f"Work authorization expiring: {payload['country']}"
    html = (
        f"<p>Your work authorization for <strong>{payload['country']}</strong> "
        f"expires on {payload['authorized_until']}.</p>"
        "<p>Update it in your Kall profile once it's renewed, or start the renewal process if you haven't already.</p>"
    )
    return subject, html


def _security_clearance_reminder_email(delivery: NotificationDelivery) -> tuple[str, str]:
    payload = delivery.payload
    subject = f"Clearance expiring: {payload['clearance_type']}"
    html = (
        f"<p>Your <strong>{payload['clearance_type']}</strong> clearance ({payload['country']}) "
        f"expires on {payload['expires_on']}.</p>"
        "<p>Update it in your Kall profile once it's renewed, or start the renewal process if you haven't already.</p>"
    )
    return subject, html


def _professional_membership_reminder_email(delivery: NotificationDelivery) -> tuple[str, str]:
    payload = delivery.payload
    membership_type = payload.get("membership_type")
    type_suffix = f" ({membership_type})" if membership_type else ""
    subject = f"Membership expiring: {payload['organization']}"
    html = (
        f"<p>Your <strong>{payload['organization']}</strong>{type_suffix} "
        f"membership expires on {payload['expires_on']}.</p>"
        "<p>Update it in your Kall profile once it's renewed, or start the renewal process if you haven't already.</p>"
    )
    return subject, html


def _reference_reminder_email(delivery: NotificationDelivery) -> tuple[str, str]:
    from html import escape

    payload = delivery.payload
    subject = f"Time to reconfirm: {payload['name']}"
    name = escape(str(payload["name"]))
    org_suffix = f" at {escape(str(payload['organization']))}" if payload.get("organization") else ""
    baseline = escape(str(payload.get("baseline_date") or payload.get("last_confirmed_on") or "an earlier date"))
    if payload.get("baseline_source") == "last_confirmed_on":
        history = f"Last confirmed on {baseline}."
    elif payload.get("baseline_source") == "created_at":
        history = f"Added to Kall on {baseline}; no confirmation date is recorded."
    else:
        # Older queued payloads used last_confirmed_on for both baselines.
        # Without provenance, do not present that date as a confirmation.
        history = f"This reminder is based on the date saved with your reference: {baseline}."
    html = (
        f"<p>You listed <strong>{name}</strong>{org_suffix} as a reference. {history}</p>"
        "<p>It's been a while. Check that they're still reachable and "
        "still willing before an employer calls them.</p>"
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
    if delivery.kind in OPPORTUNITY_KINDS:
        return _digest_email(session, delivery)
    if delivery.kind == "payment_grace_period_expired":
        return _payment_grace_period_expired_email(delivery)
    if delivery.kind == "morning_brief":
        return _morning_brief_email(session, delivery)
    if delivery.kind == "certification_renewal":
        return _certification_renewal_email(delivery)
    if delivery.kind == "growth_milestone_reminder":
        return _growth_milestone_reminder_email(delivery)
    if delivery.kind == "work_authorization_reminder":
        return _work_authorization_reminder_email(delivery)
    if delivery.kind == "security_clearance_reminder":
        return _security_clearance_reminder_email(delivery)
    if delivery.kind == "professional_membership_reminder":
        return _professional_membership_reminder_email(delivery)
    if delivery.kind == "reference_reminder":
        return _reference_reminder_email(delivery)
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
    key = dedupe_key or f"{kind}:{user_id}:{utcnow().date().isoformat()}"
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


def _digest_sent_today(session: Session, user_id: int, preference: NotificationPreference, now: datetime) -> bool:
    today = as_local(now, preference.timezone).date()
    recent = session.exec(select(NotificationDelivery).where(
        NotificationDelivery.user_id == user_id,
        NotificationDelivery.kind == "opportunity_digest",
        NotificationDelivery.status == "sent",
        NotificationDelivery.delivered_at >= now - timedelta(days=2),
    ))
    return any(as_local(row.delivered_at, preference.timezone).date() == today for row in recent)


def process_delivery(session: Session, delivery: NotificationDelivery, now: datetime | None = None) -> str:
    """Claim before sending, recheck consent, and never blindly retry an uncertain send."""
    now = now or utcnow()
    key = (f"opportunity-user:{delivery.user_id}" if delivery.kind in OPPORTUNITY_KINDS
           else f"delivery:{delivery.user_id}:{delivery.channel}:{delivery.dedupe_key}")
    token = work_claims.acquire(session, key, now, user_id=delivery.user_id)
    if not token:
        return "busy"
    try:
        session.refresh(delivery)
        if delivery.status == "sending":
            if delivery.claimed_until and delivery.claimed_until > now:
                return "busy"
            delivery.status = "ambiguous"
            delivery.last_error = "Worker stopped during a send; reconcile provider evidence before retrying."
            finish_events(session, delivery, "ambiguous")
            session.add(delivery)
            session.commit()
            return delivery.status
        if delivery.status not in ("queued", "retrying"):
            return delivery.status
        if delivery.next_attempt_at and delivery.next_attempt_at > now:
            return delivery.status
        other = session.exec(select(NotificationDelivery).where(
            NotificationDelivery.user_id == delivery.user_id,
            NotificationDelivery.channel == delivery.channel,
            NotificationDelivery.dedupe_key == delivery.dedupe_key,
            NotificationDelivery.id != delivery.id,
            NotificationDelivery.status.in_(["sent", "sending", "ambiguous"]),
        )).first()
        if other:
            delivery.status = "duplicate" if other.status == "sent" else "ambiguous"
            finish_events(session, delivery, delivery.status)
            session.add(delivery)
            session.commit()
            return delivery.status
        user = session.get(User, delivery.user_id)
        preference = preference_for(session, delivery.user_id)
        enabled = preference.email_enabled if delivery.channel == "email" else preference.push_enabled
        if not user or not user.is_active or not enabled:
            delivery.status = "skipped"
            finish_events(session, delivery, "skipped")
            session.add(delivery)
            session.commit()
            return delivery.status
        if in_quiet_hours(preference, now):
            delivery.status = "retrying"
            delivery.next_attempt_at = after_quiet_hours(preference, now)
            session.add(delivery)
            session.commit()
            return delivery.status
        if delivery.kind in OPPORTUNITY_KINDS:
            if preference.delivery_mode != "immediate":
                sent_today = _digest_sent_today(session, user.id, preference, now)
                if not digest_ready(preference, now) or sent_today:
                    delivery.next_attempt_at = next_digest(preference, now, tomorrow=sent_today)
                    session.add(delivery)
                    session.commit()
                    return delivery.status
                delivery.kind = "opportunity_digest"
            else:
                cycle_start = now.replace(second=0, microsecond=0) - timedelta(minutes=now.minute % 5)
                recently_sent = session.exec(select(NotificationDelivery.id).where(
                    NotificationDelivery.user_id == user.id,
                    NotificationDelivery.kind.in_(OPPORTUNITY_KINDS),
                    NotificationDelivery.status == "sent",
                    NotificationDelivery.delivered_at >= cycle_start,
                )).first()
                if recently_sent is not None:
                    delivery.next_attempt_at = cycle_start + timedelta(minutes=5)
                    session.add(delivery)
                    session.commit()
                    return delivery.status
                delivery.kind = "opportunity_immediate"
            from kall.models import OpportunityNotificationEvent
            events = list(session.exec(select(OpportunityNotificationEvent).where(
                OpportunityNotificationEvent.delivery_id == delivery.id,
                OpportunityNotificationEvent.user_id == user.id,
                OpportunityNotificationEvent.status == "assigned",
            )))
            sources = eligible_source_opportunities(session, user.id,
                job_ids=[event.job_id for event in events] if events else None,
                opportunity_ids=delivery.payload.get("opportunity_ids", []))
            eligible = list({row.id: row for rows in sources.values() for row in rows}.values())
            for event in events:
                if event.job_id not in sources:
                    event.status = "skipped"
                    session.add(event)
            delivery.payload = {**delivery.payload, "opportunity_ids": [row.id for row in eligible]}
            if not eligible:
                delivery.status = "skipped"
                finish_events(session, delivery, "skipped")
                session.add(delivery)
                session.commit()
                return delivery.status
        try:
            subject, body = _render(session, delivery)
        except (ValueError, KeyError, TypeError):
            delivery.status = "failed"
            delivery.last_error = "Notification payload could not be rendered."
            finish_events(session, delivery, "failed")
            session.add(delivery)
            session.commit()
            return delivery.status
        delivery.status = "sending"
        delivery.claimed_until = now + timedelta(seconds=180)
        session.add(delivery)
        session.commit()
        service = NotificationService()
        try:
            if delivery.channel == "email":
                message_id = service.send_email(user.email, subject, body, actions=[])
            else:
                message_id = service.send_push(user.id, subject, body, actions=[])
        except NotConfiguredError:
            delivery.status = "queued"
            delivery.last_error = "Delivery provider is not configured."
        except RetryableDeliveryError as error:
            _fail_or_retry(session, delivery, str(error), now)
        except PermanentDeliveryError as error:
            delivery.status = "failed"
            delivery.attempts += 1
            delivery.last_error = str(error)
        except Exception as error:  # an unknown outcome must not silently resend
            delivery.status = "ambiguous"
            delivery.attempts += 1
            delivery.last_error = f"Uncertain provider outcome ({type(error).__name__}); manual reconciliation required."
        else:
            delivery.status = "sent"
            delivery.delivered_at = now
            delivery.provider_message_id = message_id if isinstance(message_id, str) else None
            delivery.last_error = None
        delivery.claimed_until = None
        if delivery.status in ("sent", "failed", "ambiguous"):
            finish_events(session, delivery, delivery.status)
        session.add(delivery)
        session.commit()
        return delivery.status
    finally:
        work_claims.release(session, key, token)


def drain(session: Session, *, now: datetime | None = None, limit: int = 500,
          deadline: float | None = None) -> dict[str, int]:
    now = now or utcnow()
    prepare_deliveries(session, now=now, deadline=deadline, limit=min(limit, 100))
    due = session.exec(select(NotificationDelivery).where(
        NotificationDelivery.status.in_(["queued", "retrying", "sending"]),
        (NotificationDelivery.next_attempt_at.is_(None)) | (NotificationDelivery.next_attempt_at <= now),
    ).order_by(NotificationDelivery.id).limit(limit)).all()
    counts: dict[str, int] = {}
    for delivery in due:
        if deadline is not None and deadline - time.monotonic() < 15:
            break
        status = process_delivery(session, delivery, now=now)
        counts[status] = counts.get(status, 0) + 1
    return counts


#: Defaults used for anyone with no NotificationPreference row at all --
#: settings/notifications lets someone set these explicitly now, but an
#: account that has never opened that page still has no row, so this is what
#: "unset" means for them. Treated as "use these defaults" rather than
#: "excluded": email_enabled defaults to True on the model itself, which only
#: means something if the absence of a row is read the same way.
_DEFAULT_DIGEST_HOUR = 8
_DEFAULT_TIMEZONE = "UTC"


def queue_daily_briefs(session: Session, *, now: datetime | None = None) -> int:
    """Queue a morning_brief delivery for every account whose local hour
    matches their preferred digest hour right now.

    Meant to be called roughly once an hour (jobs/daily_brief.py); calling it
    more than once inside the matching hour queues duplicate rows, but that is
    harmless -- drain()'s own dedupe_key check (see _already_sent) only ever
    lets one of them actually send. Returns the number queued.
    """
    now = now or utcnow()
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
        if local_hour(timezone_name, now) != digest_hour:
            continue
        queue(session, user_id=user.id, kind="morning_brief")
        queued += 1
    return queued
