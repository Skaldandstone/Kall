# Kall project handoff

**Prepared:** August 21, 2026  
**Repository:** `Grunklegrok/Kall`  
**Branch reviewed:** `main` at `0fbd893`  
**Declared runtime version:** `0.8.1`

## Executive summary

Kall is a broad, working alpha rather than a production-ready MVP. The repository contains a substantial end-to-end foundation: authenticated career profiles, resume ingestion and intelligence, opportunity discovery, matching, application preparation and tracking, privacy controls, billing, strong-auth foundations, and a Next.js web client. The most recent merged work added application pipeline controls and actionable resume recommendations.

The project should currently be treated as **late alpha / pre-beta**. Feature breadth is strong, but the release baseline is not trustworthy yet: `main` is red in CI, no recent green baseline was found, the backend suite cannot run until its lint/contract-test breakage is repaired, and several production integrations remain adapters or local-filesystem implementations. The next owner should prioritize stabilization and a complete canonical-journey test before adding scope.

## Current snapshot

| Area | State | Notes |
| --- | --- | --- |
| Git | Clean and synchronized at start of audit | `main` matched `origin/main`; latest merge was PR #74. |
| API | Substantial alpha implementation | FastAPI, roughly 116 route decorators and 74 SQLModel tables across identity, resumes, opportunities, applications, billing, security, and growth. |
| Web | Broad functional surface | Next.js app with 34 route pages; latest GitHub web build passed. |
| Database | Migration foundation present | 14 sequential Alembic revisions through strong authentication. Migration execution is configured in CI and the API container. |
| Tests | Present but currently blocked | 56 Python test functions. Backend CI stops at Ruff before pytest. No automated web unit or end-to-end suite is present. |
| Deployment | Configured, not verified live | Dockerfiles, PostgreSQL configuration, health/readiness routes, and a deployment runbook exist. No live environment status can be inferred from the repository. (Since superseded: deployment is AWS ECS -- see `docs/AWS_DEPLOYMENT.md`.) |
| Mobile/Desktop | Placeholder only | Each surface contains a README, not an application. |

## What is implemented

### User and career foundation

- Registration, login, session revocation, password reset, email-verification tokens, and lockout protection.
- OAuth configuration surfaces plus TOTP and WebAuthn/passkey foundations.
- Integrated onboarding and multiple career strategies/profiles.
- Candidate profile resources including education, skills, credentials, work authorization, EEO data, references, and field-level privacy controls.

### Resume and document workflow

- Resume upload, extraction, metadata, versions, per-profile defaults, and readiness scoring.
- Resume intelligence with deterministic fallback recommendations and optional OpenAI-backed recommendations.
- Selected recommendations can create a new resume version; resumes can be removed with linked defaults cleared.
- Tailoring proposals, generated resumes and cover letters, keyword coverage, artifact download, and audit records.

### Opportunity and application workflow

- Greenhouse, Lever, and Ashby job discovery plus web-search ingestion boundaries.
- Matching, match evidence, opportunity inbox states, deduplication, and scheduled-discovery records.
- Morning Brief assembled from stored user data.
- Application preparation, review, approval, pipeline stages, stage movement, removal, and search-result suppression/restoration.
- Immutable submission preview, approval freshness checks, document checksums, sensitive-field confirmation, idempotency keys, and submission audit records.

### Commercial and operational foundation

- Stripe Checkout, subscription, webhook, portal, quota, and usage-record foundations.
- Docker-based API/web deployment and PostgreSQL production settings.
- Production configuration rejects a default secret, SQLite, or a missing encryption key.
- Health/readiness and operations routes.

## Confirmed gaps and risks

### P0 — restore a green baseline

The latest CI run for `main` failed in the backend Ruff step; the web job passed. Local Ruff reproduced eight errors:

- Two `E712` errors in `backend/kall/api_resume_intelligence.py` for boolean SQLModel comparisons.
- `tests/test_integration_contracts.py` has two unused imports and references missing `_app_paths` and `SQLModel` symbols.

Because lint runs before pytest and migrations, the current commit has no complete CI verification. The latest 100 CI records inspected were failures. Fix these errors, then run every CI step and make the first green commit the new stabilization baseline.

Latest audited run: <https://github.com/Grunklegrok/Kall/actions/runs/30845685524>

### P0 — prove the canonical user journey

There is no automated browser test covering sign-in → onboarding → career profile → resume upload → Morning Brief → opportunity review → application preparation/review. Add one seeded end-to-end smoke test and a production-like manual checklist. This is the most important evidence needed for an MVP exit decision.

### P1 — production integrations are incomplete

- Notification delivery currently prints email/push actions; provider credentials and real delivery adapters are not implemented.
- Discovery schedules and due-date logic exist, but no production scheduler/worker process is configured.
- Greenhouse/Lever/Ashby providers collect jobs. The submission domain validates and records attempts, but no concrete production ATS submission connector was found; the only `submit` implementation is the mock provider.
- Resume uploads and generated artifacts are written to local paths. Compose mounts `uploads` and `generated`. (Since resolved on AWS: `AWS_S3_BUCKET` routes both to S3 -- see `docs/AWS_DEPLOYMENT.md`.)

### P1 — security and release validation

- The web client stores bearer tokens in `localStorage` across most authenticated screens. Before public exposure, perform an XSS/session-storage threat review and decide whether to migrate to secure, HTTP-only cookies.
- Run an authorization/ownership audit against every mutable route, with special attention to file downloads, deletes, application stage changes, and recommendation application.
- Validate encryption-key rotation/recovery, backup/restore, Stripe webhook replay, rate limiting, upload limits/content validation, and log redaction.
- Accessibility is a stated WCAG 2.2 AA target but no automated or recorded audit is present.

### P1 — documentation and version drift

Version signals disagree: `VERSION` and the FastAPI app report `0.8.1`, `pyproject.toml` and the changelog report `0.3.0`, the latest release notes are `0.7.0`, and the root `package.json` describes an unrelated Vite app at `0.1.0`. The top-level README also stops at v0.3. Select one release source of truth, update the onboarding/deployment docs, and remove or clearly explain the root Vite package.

The committed `backend/kall_career_platform.egg-info` metadata is also stale relative to `pyproject.toml`. Generated package metadata should normally be removed from source control and ignored.

### P2 — engineering quality and maintainability

- The web package has no committed npm lockfile, so CI dependencies are not exactly reproducible.
- The web app has no test script and no unit/component/browser test suite; GitHub CI only performs a production build.
- Several pages duplicate token retrieval and fetch/error handling. A typed API client and centralized auth/session layer would reduce drift.
- Observability, analytics, performance budgets, and incident/rollback procedures are not evidenced beyond basic health routes and deployment notes.

## Recommended next sequence

1. **Stabilize `main`:** fix all Ruff issues, repair the integration-contract helpers/imports, run pytest with coverage, run Alembic from an empty database, compile Python, and rerun the Next.js production build.
2. **Create a reproducible toolchain:** commit the chosen web lockfile, remove stale generated Python metadata, align package/version declarations, and update quick-start instructions for Windows and Unix.
3. **Exercise the canonical journey:** add an end-to-end seeded smoke test and complete one manual pass against a production-like PostgreSQL environment.
4. **Close data durability gaps:** move uploads/generated documents to durable object storage or attach verified persistent disks; test backup and restore.
5. **Finish or explicitly defer adapters:** production scheduler, email/push delivery, and ATS submission connectors. Label any deferred surface clearly in product copy.
6. **Run beta-readiness reviews:** security/authorization, accessibility, privacy/data deletion, Stripe sandbox, observability, and operational rollback.
7. **Only then open private beta:** invite a small cohort and measure onboarding completion, Morning Brief usefulness, opportunity relevance, application-review safety, and failure rates.

## Verification record

Audit commands and results on August 21, 2026:

| Check | Result |
| --- | --- |
| `git status --short --branch` | Clean at audit start; `main...origin/main`. |
| `python -m compileall -q backend tests scripts migrations` | Passed. |
| `ruff check .` | Failed with eight confirmed errors described above. |
| `pytest --cov=kall` | Not completed locally because the interrupted isolated dependency setup left FastAPI unavailable; current contract-test undefined symbols would also prevent a clean run. |
| Latest GitHub CI | Backend failed at Ruff; web production build succeeded. |
| Local web build | Not run directly because Node.js/npm was unavailable in the original shell environment; GitHub CI provides the current successful build evidence. |

## Key entry points

- Product baseline: `docs/prd/01-mvp-requirements.md`
- Product roadmap: `docs/prd/02-roadmap.md`
- API startup and router registration: `backend/kall/main.py`, `backend/kall/router_registry.py`
- Domain models: `backend/kall/models/`
- Web routes and navigation: `apps/web/app/`, `apps/web/app/components/AppNav.tsx`
- Database migrations: `migrations/versions/`
- Deployment runbooks: `docs/AWS_DEPLOYMENT.md`, `docs/PRODUCTION_DEPLOYMENT.md`
- CI definition: `.github/workflows/ci.yml`

## Handoff definition of done

Before calling this MVP/beta-ready, require all of the following:

- Green backend and web CI on `main`, including tests and migrations.
- Passing canonical-journey browser smoke test.
- Production-like PostgreSQL deployment with durable file storage.
- Verified auth, ownership, encryption, data deletion, and backup/restore behavior.
- Stripe test-mode checkout/webhook/portal pass.
- Clear status for scheduler, notifications, and ATS submission adapters.
- Accessibility and responsive-layout audit completed.
- One synchronized version and updated release/deployment documentation.

