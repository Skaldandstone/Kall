from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlmodel import Session

from kall.db import get_session

router = APIRouter(tags=["operations"])

LATEST_ANDROID_VERSION = "1.1.2"
PLAY_TEST_URL = "https://play.google.com/apps/testing/com.skaldandstone.kall"


@router.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    """Liveness probe: confirms that the API process can answer requests."""
    return {"status": "ok"}


@router.get("/api/mobile-release", include_in_schema=False)
def mobile_release() -> dict[str, str]:
    """Tell Android beta builds which tested release should be installed."""
    return {
        "platform": "android",
        "latestVersion": LATEST_ANDROID_VERSION,
        "updateUrl": PLAY_TEST_URL,
    }


@router.get("/ready", include_in_schema=False)
def ready(session: Session = Depends(get_session)) -> dict[str, str]:
    """Readiness probe: confirms that the API can reach its configured database."""
    try:
        session.exec(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - depends on deployment failure mode
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ready"}
