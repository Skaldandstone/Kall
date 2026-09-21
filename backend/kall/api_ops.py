import re

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlmodel import Session

from kall.db import get_session

router = APIRouter(tags=["operations"])

LATEST_ANDROID_VERSION = "1.2.0"
LEGACY_TESTER_VERSION = "1.1.6"
PLAY_TEST_URL = "https://play.google.com/apps/testing/com.skaldandstone.kall"
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.skaldandstone.kall"


def _version_at_most(value: str, ceiling: str) -> bool:
    if not re.fullmatch(r"\d+\.\d+\.\d+", value):
        return False
    return tuple(map(int, value.split("."))) <= tuple(map(int, ceiling.split(".")))


@router.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    """Liveness probe: confirms that the API process can answer requests."""
    return {"status": "ok"}


@router.get("/api/mobile-release", include_in_schema=False)
def mobile_release(response: Response, installed: str | None = None) -> dict[str, str]:
    """Tell Android builds which release should be installed.

    The closed-test link remains for legacy builds that only trust that exact
    URL. Current builds and direct requests receive the public Play listing.
    """
    response.headers["Cache-Control"] = "no-store"
    update_url = (
        PLAY_TEST_URL
        if installed and _version_at_most(installed, LEGACY_TESTER_VERSION)
        else PLAY_STORE_URL
    )
    return {
        "platform": "android",
        "latestVersion": LATEST_ANDROID_VERSION,
        "updateUrl": update_url,
    }


@router.get("/ready", include_in_schema=False)
def ready(session: Session = Depends(get_session)) -> dict[str, str]:
    """Readiness probe: confirms that the API can reach its configured database."""
    try:
        session.exec(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - depends on deployment failure mode
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ready"}
