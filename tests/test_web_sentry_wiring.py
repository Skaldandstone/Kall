"""The browser half of Sentry has to survive prerendering.

Kall's marketing pages are static: `next build` renders them once, inside the
image build, and their HTML never changes afterwards. A DSN served from the
running task's environment (the root layout's `<meta>` tag) therefore never
reaches them - which is exactly how the first production rollout shipped with
the browser SDK inert. The build argument is the load-bearing path; the tag is
a fallback for dynamically rendered pages. There is no JS unit-test runner in
this repo, so this pins the contract textually, like `test_web_access_gate.py`.
"""

from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "apps" / "web"
DOCKERFILE = (WEB / "Dockerfile").read_text()
CLIENT = (WEB / "instrumentation-client.ts").read_text()
SERVER = (WEB / "instrumentation.ts").read_text()
NEXT_CONFIG = (WEB / "next.config.mjs").read_text()
SHARED = (WEB / "lib" / "sentry-shared.ts").read_text()

INGEST_HOST = "https://o4512015786377216.ingest.us.sentry.io"


def test_web_image_inlines_the_browser_dsn_at_build() -> None:
    builder = DOCKERFILE.split("FROM base AS builder", 1)[1].split("FROM base AS runtime", 1)[0]
    assert "ARG NEXT_PUBLIC_SENTRY_DSN=" in builder, "empty default keeps the SDK inert"
    assert "NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN" in builder
    # The build arg is exported before `npm run build`, where Next inlines it.
    assert builder.index("NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN") < builder.index("npm run build")


def test_browser_sdk_prefers_the_inlined_dsn_and_falls_back_to_the_meta_tag() -> None:
    assert "process.env.NEXT_PUBLIC_SENTRY_DSN || readMeta(SENTRY_DSN_META_NAME)" in CLIENT
    assert "if (dsn) {" in CLIENT, "no DSN means no init"


def test_server_runtimes_read_the_task_variable() -> None:
    assert "process.env.SENTRY_DSN" in SERVER
    assert "if (!dsn) return;" in SERVER


def test_browser_sdk_is_privacy_narrowed() -> None:
    assert "sendDefaultPii: false" in SHARED
    assert "tracesSampleRate: 0" in SHARED
    assert "beforeSend: scrubEvent" in SHARED
    assert "replaysSessionSampleRate: 0" in CLIENT
    assert "replaysOnErrorSampleRate: 0" in CLIENT


def test_csp_allows_only_the_studio_ingest_host() -> None:
    assert f'const SENTRY_INGEST = "{INGEST_HOST}";' in NEXT_CONFIG
    connect_src = [line for line in NEXT_CONFIG.splitlines() if "connect-src" in line][0]
    assert "${SENTRY_INGEST}" in connect_src
    assert "*.sentry.io" not in connect_src
