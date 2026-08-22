# Kall Project Handoff

**Assessment date:** 2026-08-21  
**Repository:** `Grunklegrok/Kall`  
**Branch:** `main`  
**Commit:** `0fbd893fc9cbc363038d5f0130f01cea210663d8`  
**Nominal API version:** `0.8.1`

## Executive summary

Kall is a broad, coherent late-alpha product implementation with a real FastAPI/SQLModel backend, a substantial Next.js web application, 14 serialized database migrations, and foundations for career identity, job discovery, matching, resume intelligence, application review, controlled submissions, authentication, billing, and privacy.

It is **not currently release-ready or safe for a clean production deployment**. The current remote `main` fails CI, 3 of 56 backend tests fail, Ruff reports 8 errors, and `alembic upgrade head` fails on a new database at migration `0014`. Production-facing integrations also remain adapter or sandbox boundaries: application attempts are recorded but not transported to ATS providers, notifications print rather than deliver, and no production scheduler runner is wired.

The right next milestone is not another feature slice. It is a stabilization release that restores a green build, makes clean migrations reliable, verifies the canonical user journey end to end, and reconciles version and product documentation.

## Current state at a glance

| Area | Status | Assessment |
| --- | --- | --- |
| Source control | Green | Local `main`, `origin/main`, and the live remote HEAD are the same commit. The working tree was clean before this handoff was added. |
| Web application | Yellow | 33 page routes cover the intended product journey. The latest GitHub Actions web job passed. There is no frontend test suite or committed dependency lockfile. |
| Backend/API | Red | 116 route operations and broad domain coverage exist, but current lint and test gates fail. |
| Database migrations | Red | The chain has one head and reaches `0014`, but a clean upgrade fails because the baseline creates current `usercredential` columns and `0014` tries to add them again. |
| Product integrations | Yellow/Red | Greenhouse, Lever, and Ashby discovery clients exist. ATS submission transport, real notifications, and the scheduler runner are not implemented. |
| Deployment | Red | Render and Docker configuration exist, but the API container runs migrations on startup; the clean-migration failure is therefore a deployment blocker. No live environment was verified during this assessment. |
| Documentation | Yellow | Strong product/architecture material exists, but the top-level roadmap, changelog, review marker, and package version still describe v0.3 while the runtime identifies as v0.8.1 and later billing/submission features are present. |
| Mobile/desktop | Gray | These are README-level boundaries only; no Expo or Tauri applications have been scaffolded. |

## What is implemented

### Canonical web journey

The Next.js application has working route-level surfaces for registration and login, onboarding, Career Profiles, Resume Studio, Morning Brief, search and opportunities, job/resume intelligence, tailoring, documents, application review, applications, submissions, testimonials, privacy, security setup, settings, and billing.

Recent merged work added:

- resume deletion and actionable resume-intelligence recommendations;
- application pipeline stage changes and application removal;
- externally submitted application tracking and search-result suppression/restoration;
- the same-origin `/api/kall` proxy for production API access;
- global toast feedback and several workflow/routing fixes.

### Backend and data model

The backend includes:

- bearer-token registration, login, logout, reset, verification, session revocation, OAuth, TOTP, and WebAuthn/passkey foundations;
- identity and professional profile storage, onboarding, resume metadata/versioning, EEO/work-authorization encryption, and field-level privacy;
- Greenhouse, Lever, and Ashby discovery, deterministic matching, opportunity inbox/schedule models, and ATS-oriented search query generation;
- resume parsing, achievement verification, match intelligence, evidence-grounded tailoring, generated resume artifacts, and cover-letter review;
- application preparation, review, explicit approval, testimonial/reference controls, controlled submission previews, confirmations, checksums, idempotent attempts, and quota checks;
- Stripe Checkout, Customer Portal, webhook, subscription, and usage foundations;
- liveness/readiness endpoints and Docker/Render deployment definitions.

### Safety posture

The core product rule is represented consistently: Kall prepares consequential application actions but requires explicit review and approval. Sensitive EEO, authorization, and reference data are private by default and excluded from public scope. Submission confirmation checks approval freshness, unanswered questions, document checksums, sensitive-field confirmation, CAPTCHAs, and unsupported fields.

## Verification performed

The following checks were run against commit `0fbd893` on 2026-08-21:

| Check | Result |
| --- | --- |
| Remote HEAD comparison | Pass — remote `main` is `0fbd893`. |
| GitHub Actions, latest `main` run | Fail — backend failed at Ruff; web passed. [Run 30845685524](https://github.com/Grunklegrok/Kall/actions/runs/30845685524) |
| Ruff | Fail — 8 errors. |
| Pytest | Fail — 53 passed, 3 failed, 56% reported coverage, 90 warnings. |
| Alembic clean upgrade | Fail at `20260802_0014_strong_auth.py` with duplicate `totp_secret_encrypted`. |
| Next.js production compilation/type checking | Pass with CSS compatibility warnings; the GitHub Actions web build also passed. Local final standalone trace packaging was blocked by Windows/pnpm symlink permissions, not a TypeScript or application compilation error. |
| Open GitHub issues/PRs/releases | None. No release tags were found. |

### Exact backend failures

Ruff reports:

- two `E712` SQLModel boolean comparisons in `backend/kall/api_resume_intelligence.py`;
- two unused imports in `tests/test_integration_contracts.py`;
- undefined `_app_paths` in `tests/test_integration_contracts.py`;
- three undefined `SQLModel` references in that same test module.

Pytest confirms the broken test module rather than exposing deeper functional failures:

- `test_router_registry_is_complete` fails because `_app_paths` is missing;
- `test_model_metadata_resolves_all_foreign_keys` fails because `SQLModel` is missing;
- `test_opportunity_migration_targets_career_goal_table` fails for the same missing import.

The other 53 tests pass, but the 56% aggregate coverage is inflated by model declarations. Many API and orchestration modules are only about 20–50% covered, and there is no browser-level coverage of the canonical journey.

### Migration root cause

Migration `0001` freezes only a list of baseline table names, then creates those tables from **current** `SQLModel.metadata`. Because the current `UserCredential` model already contains `totp_secret_encrypted` and `totp_enabled`, a new database receives those columns in `0001`. Migration `0014` then tries to add the same columns and fails.

This matters operationally because `Dockerfile.api` executes `alembic upgrade head` before starting Uvicorn. A new environment cannot start reliably until the historical schema is made genuinely immutable or `0014` is made safe for the supported upgrade paths.

## Important gaps and risks

### Release blockers

1. **CI is red on `main`.** Branch protection did not prevent a failing merge, or it is not configured to require the relevant checks.
2. **Clean database bootstrap is broken.** This blocks new developer and hosted environments and undermines disaster recovery.
3. **The integration-contract test file is incomplete.** It appears to have lost its `SQLModel` import and `_app_paths` helper.
4. **Version identity is inconsistent.** `VERSION` and FastAPI say `0.8.1`; `pyproject.toml`, `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `PR_SUMMARY.md`, and `READY_FOR_REVIEW` still identify the project as v0.3-era work. Billing and controlled-submission changes were merged as v0.9/v0.10 slices without a corresponding unified release version.

### Product and operational gaps

- `create_attempt` records an idempotent submission attempt but no Greenhouse, Lever, or Ashby submission transport is called. Do not describe Kall as automatically submitting applications yet.
- `NotificationService` prints email and push messages. Delivery providers, retry workers, and a production digest path are not wired.
- Opportunity schedule calculation and records exist, but no deployed scheduler/worker runner was found.
- Mobile and desktop are plans, not products.
- The web mixes same-origin proxy calls with direct `NEXT_PUBLIC_API_URL` calls. This increases environment/CORS complexity and should be normalized.
- Document download links are plain anchors to an authenticated endpoint and cannot attach the bearer token used elsewhere. Verify and repair this flow before beta.
- Dependencies are range-based and there is no committed lockfile for the web app, so builds are not fully reproducible.
- The root Vite `package.json` and `index.html` coexist with the real Next.js app under `apps/web`; ownership and intended use of the root frontend scaffold are unclear.
- The documented quality gates include frontend route/component tests, accessibility checks, and end-to-end coverage, but none are configured in CI.
- No successful production smoke test, Stripe sandbox run, OAuth setup, real notification delivery, ATS submission, or restore exercise is recorded in the repository.

## Recommended next work, in order

### 1. Restore a green stabilization branch

- Rebuild `tests/test_integration_contracts.py` with the missing imports/helper.
- Fix the two SQLModel boolean lint errors.
- Run Ruff, compileall, all tests, and the web production build.
- Require backend and web CI checks on `main` before future merges.

### 2. Repair and prove migrations

- Make migration `0001` construct the actual v0.3 column schema rather than current model metadata, or introduce a carefully reviewed equivalent that preserves already-deployed databases.
- Test both a brand-new database and an upgrade from every database state known to have been deployed.
- Add a CI assertion that performs a clean `alembic upgrade head` before allowing merge.
- Validate on PostgreSQL as well as SQLite; production is PostgreSQL.

### 3. Define a single stabilization release

- Decide whether the next honest version is `0.8.2`, `0.10.0`, or a new pre-beta identifier.
- Align `VERSION`, FastAPI, Python package metadata, changelog, roadmap, release notes, and review marker.
- Remove or explicitly archive the root Vite scaffold if Next.js is the sole web client.
- Commit a dependency lockfile and use deterministic installs in CI and Docker.

### 4. Prove the canonical user journey

Add one end-to-end path using real stored data:

`register → onboard → create profile → upload resume → view brief → discover/import job → review match → prepare application → approve → record manual submission`

Cover signed-out, empty, error, authorization, sensitive-data, and ownership cases. Add accessibility checks for the primary workspaces.

### 5. Choose the beta integration boundary

For private beta, either:

- explicitly ship manual handoff after controlled preparation and track external submissions; or
- implement and certify one ATS submission connector end to end.

Do not hold beta on three simultaneous ATS submission connectors. One honest, observable path is more valuable than three adapter shells.

### 6. Perform a deployment rehearsal

- Create a fresh PostgreSQL database and deploy API/web from the release candidate.
- Verify `/health` and `/ready`, registration, encrypted sensitive fields, document persistence/downloads, and restart behavior.
- Complete Stripe test-mode Checkout, webhook replay/idempotency, Customer Portal, cancellation, quota, and recovery checks.
- Add structured logging, error reporting, backups, and a rollback/restore procedure before inviting users.

## Suggested ownership split

| Workstream | Immediate deliverable |
| --- | --- |
| Backend/platform | Green CI, repaired migration history, PostgreSQL upgrade test, version alignment. |
| Web/product | Normalize API access, repair authenticated downloads, add the canonical end-to-end test, accessibility pass. |
| Integrations/ops | Define manual-vs-automated beta boundary, wire scheduler/notifications only to the agreed scope, execute deployment rehearsal. |
| Product | Reconcile roadmap and release claims, define private-beta acceptance criteria, choose a small test cohort and feedback protocol. |

## Key files for the next owner

- `README.md` — current setup instructions, but stale version narrative.
- `docs/prd/01-mvp-requirements.md` — best statement of the canonical journey and MVP exit criteria.
- `docs/prd/02-roadmap.md` — more accurate than the stale top-level `docs/ROADMAP.md`.
- `docs/architecture/engineering-contract.md` — intended API and quality contract.
- `backend/kall/main.py` and `backend/kall/router_registry.py` — application composition and API registration.
- `migrations/versions/20260802_0001_initial.py` and `20260802_0014_strong_auth.py` — clean-bootstrap failure.
- `tests/test_integration_contracts.py` — immediate lint/test breakage.
- `.github/workflows/ci.yml` — present quality gates and their sequencing.
- `render.yaml`, `Dockerfile.api`, and `apps/web/Dockerfile` — deployment topology.
- `backend/kall/services/submissions.py`, `notifications.py`, and `discovery.py` — clearest view of integration boundaries.
- `apps/web/app/api/kall/[...path]/route.ts` — production API proxy.

## Handoff definition of done

The stabilization milestone is complete when:

- `main` is green in CI;
- a fresh PostgreSQL database reaches Alembic head;
- the canonical journey passes in an automated browser test;
- protected data and ownership tests pass;
- the chosen beta submission boundary is accurately represented in product copy;
- a production-like deployment rehearsal and Stripe sandbox checklist pass;
- version, roadmap, changelog, and release notes agree;
- the release is tagged and has a rollback/restore note.

Until those conditions are met, treat Kall as a promising internal alpha with a large implemented surface—not as a production beta.
