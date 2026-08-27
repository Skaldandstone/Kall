from typing import Any

from fastapi import APIRouter, Depends
from sqlmodel import Session

from kall.auth import get_current_user
from kall.db import get_session
from kall.models import User
from kall.services.brief import build_morning_brief

router = APIRouter(tags=["morning-brief"])


@router.get("/me/morning-brief")
def morning_brief(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Return a grounded daily summary assembled from the user's existing Kall data.

    The logic lives in services/brief.py, shared with the emailed version of
    this same brief (see services/notification_delivery.py) so the two never
    drift apart.
    """
    return build_morning_brief(session, current_user)
