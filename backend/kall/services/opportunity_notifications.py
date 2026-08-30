"""Durable posting-change events, coalesced before email delivery."""

import time
from datetime import UTC, datetime

from kall.models import (
    CareerProfile,
    Job,
    JobMatch,
    NotificationDelivery,
    NotificationPreference,
    Opportunity,
    OpportunityNotificationEvent,
    User,
)
from kall.services import work_claims
from kall.services.discovery_matching import refresh_discovered_job_match
from kall.services.matching import is_out_of_scope
from kall.services.notification_timing import as_local
from kall.services.suppression import DISCOVERY_BLOCKING_REASONS, is_suppressed, suppressed_urls
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

OPPORTUNITY_KINDS = ("opportunity_digest", "opportunity_immediate")


def preference_for(session: Session, user_id: int) -> NotificationPreference:
    return session.exec(select(NotificationPreference).where(
        NotificationPreference.user_id == user_id,
    )).first() or NotificationPreference(user_id=user_id)


def record_event(session: Session, user_id: int, job_id: int, fingerprint: str) -> bool:
    try:
        with session.begin_nested():
            session.add(OpportunityNotificationEvent(user_id=user_id, job_id=job_id, fingerprint=fingerprint))
            session.flush()
    except IntegrityError:
        return False
    return True


def eligible_opportunities(session: Session, user_id: int, *, job_ids: list[int] | None = None,
                           opportunity_ids: list[int] | None = None) -> list[Opportunity]:
    preference = preference_for(session, user_id)
    user = session.get(User, user_id)
    if not user or not user.is_active or not preference.email_enabled:
        return []
    statement = select(Opportunity, CareerProfile, Job).join(
        CareerProfile, CareerProfile.id == Opportunity.professional_profile_id,
    ).join(Job, Job.id == Opportunity.job_id).where(
        Opportunity.user_id == user_id, CareerProfile.user_id == user_id, CareerProfile.is_active.is_(True),
        Opportunity.state.in_(["new", "saved", "reviewing"]),
    )
    if job_ids is not None:
        statement = statement.where(Opportunity.job_id.in_(job_ids))
    if opportunity_ids is not None:
        statement = statement.where(Opportunity.id.in_(opportunity_ids))
    blocked = suppressed_urls(session, user_id, reasons=DISCOVERY_BLOCKING_REASONS)
    best: dict[int, Opportunity] = {}
    for opportunity, profile, job in session.exec(statement):
        if is_out_of_scope(job, profile) or is_suppressed(job.url, blocked):
            continue
        match = session.exec(select(JobMatch).where(
            JobMatch.user_id == user_id, JobMatch.career_profile_id == profile.id, JobMatch.job_id == job.id,
        )).first()
        if match and (profile.updated_at > match.updated_at or job.updated_at > match.updated_at):
            match = refresh_discovered_job_match(session, user=user, profile=profile, job=job)
            if match is None:
                continue
        if opportunity.match_score < preference.minimum_match_score:
            continue
        if opportunity.job_id not in best or opportunity.match_score > best[opportunity.job_id].match_score:
            best[opportunity.job_id] = opportunity
    return sorted(best.values(), key=lambda row: (-row.match_score, row.id))


def finish_events(session: Session, delivery: NotificationDelivery, status: str) -> None:
    for event in session.exec(select(OpportunityNotificationEvent).where(
        OpportunityNotificationEvent.delivery_id == delivery.id,
        OpportunityNotificationEvent.status == "assigned",
    )):
        event.status = status
        session.add(event)


def prepare_deliveries(session: Session, *, now: datetime | None = None,
                       deadline: float | None = None, limit: int = 100) -> int:
    """At most one pending opportunity summary per user, including quiet-hour backlog.

    The user-level lease is also held while sending so a producer cannot append
    events after a sender has captured the message body.
    """
    now = now or datetime.utcnow()
    user_ids = list(session.exec(select(OpportunityNotificationEvent.user_id).where(
        OpportunityNotificationEvent.status == "pending",
    ).distinct().limit(limit)))
    queued = 0
    for user_id in user_ids:
        if deadline is not None and deadline - time.monotonic() < 2:
            break
        key = f"opportunity-user:{user_id}"
        token = work_claims.acquire(session, key, now, user_id=user_id)
        if not token:
            continue
        try:
            events = list(session.exec(select(OpportunityNotificationEvent).where(
                OpportunityNotificationEvent.user_id == user_id,
                OpportunityNotificationEvent.status == "pending",
            ).order_by(OpportunityNotificationEvent.id).limit(500)))
            if not events:
                continue
            opportunities = eligible_opportunities(session, user_id, job_ids=[e.job_id for e in events])
            eligible_ids = {o.job_id for o in opportunities}
            accepted = []
            for event in events:
                if event.job_id in eligible_ids:
                    accepted.append(event)
                else:
                    event.status = "skipped"
                    session.add(event)
            if not accepted:
                session.commit()
                continue
            preference = preference_for(session, user_id)
            pending = session.exec(select(NotificationDelivery).where(
                NotificationDelivery.user_id == user_id,
                NotificationDelivery.kind.in_(OPPORTUNITY_KINDS),
                NotificationDelivery.status.in_(["queued", "retrying"]),
            ).order_by(NotificationDelivery.id)).first()
            if pending is None:
                local_date = as_local(now, preference.timezone).date().isoformat()
                cycle = int(now.replace(tzinfo=UTC).timestamp()) // 300
                dedupe_key = f"opportunities:{user_id}:{local_date}:{cycle}"
                if session.exec(select(NotificationDelivery.id).where(
                    NotificationDelivery.user_id == user_id, NotificationDelivery.dedupe_key == dedupe_key,
                    NotificationDelivery.status.in_(["sent", "sending", "ambiguous"]),
                )).first() is not None:
                    session.commit()
                    continue
                kind = "opportunity_immediate" if preference.delivery_mode == "immediate" else "opportunity_digest"
                pending = NotificationDelivery(
                    user_id=user_id, channel="email", kind=kind,
                    dedupe_key=dedupe_key,
                    payload={"opportunity_ids": [], "event_ids": []},
                )
                session.add(pending)
                session.flush()
                queued += 1
            payload = pending.payload or {}
            pending.payload = {
                "opportunity_ids": sorted(set(payload.get("opportunity_ids", [])) | {o.id for o in opportunities}),
                "event_ids": sorted(set(payload.get("event_ids", [])) | {e.id for e in accepted}),
            }
            session.add(pending)
            for event in accepted:
                event.delivery_id = pending.id
                event.status = "assigned"
                session.add(event)
            session.commit()
        finally:
            work_claims.release(session, key, token)
    return queued
