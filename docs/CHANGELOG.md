# Changelog

## 0.9.0

- Migrated hosting from Render to AWS (ECS Fargate, RDS Postgres with enforced TLS, CloudFront for HTTPS, Secrets Manager) - see `docs/AWS_DEPLOYMENT.md`.
- Moved resume and generated-document storage to S3 so files survive a redeploy of the (ephemeral) API container, instead of living on local disk.
- Fixed real SSO/passkey production blockers and added authenticated account linking; passkey registration now offers a QR-first (hybrid) flow.
- Consolidated the web navigation from ad hoc, overlapping pages into four tabbed sections - Applications, Opportunities, Career, Documents - fixing several real bugs surfaced along the way (a stuck application-review status, dead query params, a `currentTarget`-after-`await` bug, a silently-`{}` tailoring-proposal response, a finalize/generate status-string mismatch).
- Added a canonical-journey end-to-end browser test (Playwright) covering register → onboarding → resume upload → Morning Brief → opportunity → application preparation/review.
- Ran a full authorization audit of every mutable API route (no IDOR findings); added rate limiting on registration/login/password-reset/email-verification, a resume upload size/type limit, and baseline security headers (CSP, X-Frame-Options, etc.).
- Removed dead scaffolding: an unused Vite/React app at the repo root (superseded by `apps/web`), a stale root `Dockerfile` referencing a nonexistent module, a duplicate `/billing/checkout` route, and committed `.egg-info` build metadata.
- Restored a green CI baseline and added an `e2e` CI job alongside `backend`/`web`.

## 0.8.x

- Added strong authentication: social identity linking, TOTP, and WebAuthn/passkey support.
- Added application-pipeline stage controls and actionable, AI-backed resume recommendations.

## 0.7.0

- Added scheduled opportunity discovery: daily/weekday/weekly schedules with overlap prevention and configurable posting-age limits.

## 0.5.1 – 0.5.4

- **0.5.1** - Resume Intelligence foundation: structured/versioned resume parsing, deterministic section and skill extraction, structured job-requirement analysis, a user-owned achievement library.
- **0.5.2** - Connected structured resume and job parsing to deterministic, auditable match intelligence (versioned resume-to-job scoring, requirement coverage and evidence records).
- **0.5.3** - Evidence-grounded resume-tailoring proposals with explicit side-by-side review.
- **0.5.4** (Document Studio) - Turned finalized, evidence-reviewed tailoring proposals into private application documents (ATS-safe DOCX/PDF/text generation, keyword coverage, cover letters, audit trail).

## 0.4

- Completed the first end-to-end career identity experience: persistent guided onboarding with readiness scoring, and CRUD APIs for education, skills, languages, certifications, clearances, awards, publications, patents, speaking, memberships, volunteer/board service, and references.

## 0.3.0

- Added Alembic migrations and PostgreSQL production support.
- Added production environment validation and CORS configuration.
- Added logout, session revocation, password reset, email verification, and lockout protection.
- Added backend and web CI jobs.
- Added local development, testing, security, and deployment documentation.
