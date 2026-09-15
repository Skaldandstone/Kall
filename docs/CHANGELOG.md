# Changelog

## 0.10.0

- Added a "Start over" control to resume tailoring review, on web and
  mobile, reachable from any phase of the review -- answering questions,
  the cover letter, or the final preview -- rather than only after picking
  a look. Discards the in-progress or already-finalized review and starts
  a fresh proposal; nothing already generated is deleted.
- Fixed a resume ending up with nothing but a summary for anyone whose PDF
  extracts as one word per line (a common artifact of designed/multi-
  column resume layouts) and has no structured Employment record in
  Kall's professional record: the word-per-line reflow only recognized a
  section heading when the word before it ended a sentence, which missed
  every heading that follows straight off a bullet list with no closing
  period -- extremely common. Also added wording-alignment suggestions for
  exactly these accounts' existing experience bullets, since role-gap and
  achievement customization only ever read Kall's own structured records,
  never the uploaded resume's text.
- Rebuilt tailoring review as a guided, one-question-at-a-time flow (role
  gaps, then the summary, then achievements) with a "choose a look" step and
  an ATS check run against the actual rendered PDF (name-first, standard
  headings, standard fonts, no images, reading order, clean text
  extraction), not just promised.
- Verified achievements now get reworded toward a posting's own language
  instead of being copied in verbatim, with the same fact-preservation
  safety net the summary rewrite already used (and a real bug fix to that
  net: its percentage-matching regex could never actually match).
- Fixed resumes silently rendering with no experience section at all for
  anyone whose original resume used a common heading spelling ("Work
  Experience", "Career History") the parser didn't recognize as an exact
  match.
- Added tiered plans (Free/Plus/Premium) with metered applications, AI
  actions, and resume storage, replacing the earlier all-or-nothing model;
  documented the cost model the prices were chosen from (`UNIT_ECONOMICS.md`).
- Added one-click apply: autofill engine that navigates a real ATS form,
  uploads the selected resume, and answers EEO/work-authorization questions
  from the stored professional record, always ask-before-submit.
- Added "help a friend": share a refreshable batch of job matches via your
  own profile, criteria you fill in for them, or a link they fill in
  themselves -- a public digest page with no apply/track action, since
  neither Kall nor the sharer can act on the friend's behalf.
- Added email integration: connect a read-only Gmail or Outlook inbox to
  auto-detect application confirmations, interview invites, and rejections;
  import an unmatched confirmation email as a tracked application; export a
  Gmail filter file to pre-tag job mail. Read-only end to end -- Kall never
  sends, deletes, or modifies anything in a connected mailbox.
- Added Workday as a discovery provider and enriched externally-imported
  postings from their own `schema.org` `JobPosting` data.
- Brought mobile to feature parity with web: full onboarding, resume
  tailoring, job intelligence, professional record, submission flow,
  monitoring, testimonials, the career page editor, documents, usage, and
  account deletion.
- Activated native billing (Apple/Google in-app subscriptions via
  RevenueCat) and portal-visible Stripe/Google Play payment history and
  refunds; scheduled notification delivery and mobile push.
- Ran a full authentication-route audit (an AST/route-introspection test
  that fails on any non-public route missing an auth dependency); caught
  and fixed a real bug it found: the email-connection OAuth callback
  required a Bearer header that a browser redirect from Google/Microsoft
  never carries, which would have 401'd on every real connection.
- Added a maintenance banner shown when the API is briefly unreachable
  during a rolling deploy, instead of a raw gateway error.

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
