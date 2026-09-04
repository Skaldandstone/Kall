from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from kall.config import get_settings
from kall.db import create_db_and_tables
from kall.observability import configure_sentry
from kall.rate_limit import limiter
from kall.router_registry import register_api_routers

settings = get_settings()
# Before the app and its middleware exist, so the SDK can wrap them. No-op
# without SENTRY_DSN.
configure_sentry(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_create_tables and settings.app_env in {"development", "test"}:
        create_db_and_tables()
    yield


app = FastAPI(
    title="Kall API",
    version="0.9.0",
    description="Career identity, scheduled opportunity discovery, growth, and review-before-submit applications",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    # The extension's origin is fixed rather than derived from settings: its
    # manifest pins a "key", which makes chrome-extension://<id> the same id
    # on every machine that loads it unpacked, not something that varies per
    # install the way a locally-generated id would. See
    # apps/extension/manifest.json and docs/EXTENSION_CLERK_SETUP.md.
    allow_origins=[settings.frontend_url, "chrome-extension://lgbplmcainecdbbkameldmpafdcnpaid"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Defense in depth for any deployment where this API is reachable
    # directly rather than only through the web app's server-side proxy.
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


register_api_routers(app)
