"""Phase 3: surface a detected email event and let the person confirm it.

Confirming drives move_application() directly -- the exact same
status-mutation path the manual drag-to-stage UI uses, not a second, parallel
way to change Application.status. _STAGE_STATUS and application_stage()
(services/applications.py) stay the single source of truth for what a
transition means: a confirmed "rejection" gets failure_reason = "Rejected by
employer" and a confirmed "interview" gets interview_scheduled_at set,
exactly like the manual path does, because it IS the manual path's function.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from kall.api_applications import move_application
from kall.auth import get_current_user
from kall.clock import utcnow
from kall.db import get_session
from kall.models import Application, EmailDetectedEvent, User

router = APIRouter(tags=["email-events"])

#: What a confirmed event actually does to the matched Application --
#: reusing move_application's own stage vocabulary rather than inventing a
#: second one.
_EVENT_STAGE = {
    "confirmation": "submitted",
    "interview": "interview",
    "rejection": "rejected",
}


class ConfirmRequest(BaseModel):
    #: Only meaningful when the event arrived unmatched -- lets the person
    #: manually point it at the right application instead of Kall guessing.
    application_id: int | None = None


def _owned_event(event_id: int, current_user: User, session: Session) -> EmailDetectedEvent:
    event = session.get(EmailDetectedEvent, event_id)
    if not event or event.user_id != current_user.id:
        raise HTTPException(404, "Event not found")
    return event


@router.get("/me/email-events")
def list_email_events(
    status: str = "pending",
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[EmailDetectedEvent]:
    return list(
        session.exec(
            select(EmailDetectedEvent)
            .where(EmailDetectedEvent.user_id == current_user.id, EmailDetectedEvent.status == status)
            .order_by(EmailDetectedEvent.created_at.desc())
        )
    )


@router.post("/me/email-events/{event_id}/confirm")
def confirm_email_event(
    event_id: int,
    payload: ConfirmRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    event = _owned_event(event_id, current_user, session)
    if event.status != "pending":
        raise HTTPException(422, "This event has already been reviewed")

    application_id = event.application_id or payload.application_id
    if not application_id:
        raise HTTPException(
            422,
            "This email didn't match an application in your pipeline -- provide application_id to link it manually, "
            "or track it as a new application instead.",
        )
    application = session.get(Application, application_id)
    if not application or application.user_id != current_user.id:
        raise HTTPException(404, "Application not found")

    stage = _EVENT_STAGE.get(event.event_type)
    if not stage:
        raise HTTPException(422, f"Don't know how to apply a {event.event_type!r} event")

    # The exact same status-mutation path the manual drag-to-stage UI uses --
    # called directly (not over HTTP) so this is the same code, not a copy.
    result = move_application(application.id, stage, current_user, session)

    event.application_id = application.id
    event.status = "confirmed"
    event.reviewed_at = utcnow()
    session.add(event)
    session.commit()
    return result


@router.post("/me/email-events/{event_id}/dismiss")
def dismiss_email_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    event = _owned_event(event_id, current_user, session)
    if event.status != "pending":
        raise HTTPException(422, "This event has already been reviewed")
    event.status = "dismissed"
    event.reviewed_at = utcnow()
    session.add(event)
    session.commit()
    return {"status": "dismissed"}
