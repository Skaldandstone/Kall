"""The public end of List-Unsubscribe (RFC 8058): no login, so a mail
client can hit this with no user interaction at all.

Deliberately turns off email only, not push -- this token is unauthenticated,
opaque proof of "the person who received this email", not proof of who is
signed in, so it should only ever do the one thing an email's own
List-Unsubscribe header promises.
"""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select

from kall.db import get_session
from kall.models.opportunities import NotificationPreference
from kall.security import user_id_from_unsubscribe_token

router = APIRouter(tags=["unsubscribe"])

_CONFIRMATION = HTMLResponse("<!doctype html><title>Unsubscribed</title>"
                              "<p>You will no longer receive email from Kall. "
                              "You can turn it back on any time from your Kall notification settings.</p>")
_INVALID = HTMLResponse("<!doctype html><title>Link expired</title>"
                         "<p>This unsubscribe link is no longer valid. Sign in to Kall and "
                         "update your notification settings directly.</p>", status_code=404)


def _unsubscribe(token: str, session: Session) -> HTMLResponse:
    user_id = user_id_from_unsubscribe_token(token)
    if user_id is None:
        return _INVALID
    preference = session.exec(
        select(NotificationPreference).where(NotificationPreference.user_id == user_id)
    ).first() or NotificationPreference(user_id=user_id)
    preference.email_enabled = False
    session.add(preference)
    session.commit()
    return _CONFIRMATION


@router.get("/unsubscribe")
def unsubscribe_get(token: str = Query(...), session: Session = Depends(get_session)) -> HTMLResponse:
    """A person clicking the link manually in a client with no one-click support."""
    return _unsubscribe(token, session)


@router.post("/unsubscribe")
def unsubscribe_post(token: str = Query(...), session: Session = Depends(get_session)) -> HTMLResponse:
    """What Gmail/Yahoo/Apple Mail actually call per List-Unsubscribe-Post."""
    return _unsubscribe(token, session)
