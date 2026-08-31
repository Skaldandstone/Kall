# Continuation integration validation

Working branch: `codex/kall-continuation-integration`. Updated 2026-08-31.
This file records completed checks separately from remaining release gates.

## Current branch and review status

- On 2026-08-31 the owner changed GitHub automation to manual-only. Main is
  `6bc0506`; automatic CI, Build and Ruff-fix workflows are disabled manually.
  Nothing in this continuation re-enables them or dispatches a run.
- PR #169 advanced to `46e2b15`, PR #170 to `2ac3947`, both with empty current
  check rollups. PR #170's only conflict was the independently added Build file.
  Merge `14ce61a` reconciles the reminder base and keeps PR #170's workflow blob
  unchanged, including its mocked Clerk safety step. Main's separate manual
  workflow is not modified. Prior green runs are historical evidence only.
- `08b0e74` records the selected Inscription identity. Exact board provenance and
  scope are in `design/identity-exploration/revision-02/selection.md`. No artwork
  bytes or production branding changed. Broader layout/navigation remains open.
- `2aaf208` integrates only the notice owner's three client files. That owner
  passed installed web/mobile TypeScript and 23 extension unit tests, without
  deployment, package build, physical-device or installed-extension acceptance.
- New Stripe work is isolated on `codex/kall-billing-isolation`, not silently
  folded into the previously validated functional queue. Live billing remains off.
- On that separate branch, final local validation passed 587 backend tests,
  42 combined safe browser cases, production web build and 90 real PostgreSQL
  contracts, including eight-worker claim/webhook races. Fresh upgrade and
  downgrade/re-upgrade preserve old schedules and paid customer records. See
  [billing evidence](billing-security.md) and [PostgreSQL evidence](postgres-validation.md).
  The synthetic PostgreSQL pilot made ten mock requests per cycle and queued
  0/0/100 events. Its temporary loopback server was stopped after validation.

The dated checkpoints below remain historical; they are not claims that current
head CI, cloud operation, paid delivery or device acceptance has completed.

## Verified at the first integration checkpoint

- Reference repair: 38 focused backend tests pass after integration. The repair
  task also proved the new dry-run persistence regression fails against the old
  CLI implementation. See [reference evidence](reference-reminders.md).
- Shared authentication-test safety: 16 tests pass with every remote request
  mocked. Production keys are refused and stale-user sweeping defaults off.
  Targeted TypeScript checking passes. See [QA safety](qa-safety.md).
- Combined reference and match-refresh-helper run: 442 tests passed and one
  database-configuration test failed because the runner explicitly set
  `DATABASE_URL=sqlite://`. That test expects the repository's default database
  URL so it can exercise construction from separate connection fields. All nine
  database-configuration tests then passed with `sqlite:///./kall.db`. This is
  recorded as a corrected test environment, not a single clean full-suite run.
- Ruff and Python compilation pass at this checkpoint.
- Fresh local SQLite migrations reached `20260828_0027`. The ignored file
  `continuation-validation.db` is retained for testing the monitoring upgrade
  against an already-created pre-monitoring schema.
- PR #169 was fast-forwarded to `6494525`. GitHub run `33339187268` started
  successfully and passed backend, web build, web browser, extension and mobile
  browser jobs. Deployment was skipped on the PR, as expected. No checks were
  bypassed, billing changed, or manual reruns requested.
- Functional-area implementation `2749395` is integrated as `3b34910`. The root
  reviewer inspected desktop and 375px editor screenshots. New controls fit;
  low-contrast field text was referred to the UI lane for its shared polish pass.
- The combined reference and functional-area implementation subsequently passed
  **all 458 backend tests** using the normal local database setting. The separate
  legacy digest guard `13f0dd9` is integrated as `b898d86`; all 10 focused digest
  eligibility and reference-email tests pass. The digest regressions now use
  fixed UTC noon for compatibility with the upcoming local-hour delivery rules.

## UI and identity integration checkpoint

- All 30 combined offline browser cases passed after integrating UI `178da69`
  and targeting `d0825d0`, at desktop 1440px and mobile 375px. Command from
  `apps/web`: `KALL_UI_PORT=3340 npx playwright test --config playwright.usability.config.ts flow.spec.ts functional-areas.spec.ts`
  (PowerShell uses `$env:KALL_UI_PORT='3340'`). This uses synthetic API fixtures,
  no Clerk global setup, no live sender and no real application submission.
- Root visually inspected all six combined targeting screenshots: editor,
  profile read view and onboarding at both widths. Entered values now use the
  corrected readable foreground; fields and navigation fit. Existing onboarding
  native multi-select and placeholder-only labels remain recorded usability debt.
  Copies are retained outside Playwright's replaceable results directory.
- The UI lane also passed its 28 behavior/capture cases and preserved 12
  inspected true-PNG captures with viewport and loaded-font metadata. Root
  independently reviewed representative preparation and search mobile captures.
- The identity package `473e86a` passed its image/manifest validator for all
  35 visuals and 32 browser records. Root reviewed the boards and representative
  desktop/mobile studies, then verified gallery comparison controls and JPEG
  links after the format correction. The initial Edition recommendation was
  subsequently withdrawn after James's Runestone feedback; the identity task is
  correcting the first studies against Kall's design foundation. Visual file
  validity does not establish alignment with the product identity.
- Notification settings introductory copy no longer claims that default email
  delivery waits for an explicit save. Morning Brief remains separately described.

## Monitoring integration checkpoint

- All three monitoring commits are integrated. The delivery merge retained the
  escaped reference renderer verbatim and the five black-box legacy eligibility
  tests, while using the new common opportunity-eligibility service. Stable job
  identity and current canonical-candidate validation remain intact.
- The first complete combined backend run passed **495 tests**. The subsequent
  department/team metadata fingerprint fix passed **47 focused regressions**
  across monitoring, opportunities, discovery refresh, digest and reference mail.
  The final full backend run then passed **496 tests** in 69.39 seconds.
- Full Ruff, Python compilation, disabled-template `cfn-lint` and offline
  preparation checks passed. The retained local revision-27 database upgraded
  successfully to `20260830_0028`; full tests also cover fresh migration and
  downgrade/re-upgrade preservation of the existing weekday schedule.
- Root independently ran the integrated controlled benchmark with temporary
  SQLite, synthetic feeds and disabled sender: ten requests per tick across five
  profiles and ten shared boards, zero activation/unchanged alerts, then 100
  private events for ten new and ten changed postings. Wall times were 36.105,
  0.598 and 6.022 seconds. See [integrated measurement](monitoring-benchmark-integrated.json).
  These unconstrained local timings are not a Fargate or PostgreSQL result.
- The complete planning worksheet totals $7.90/month under its stated runtime,
  email-volume, routing and storage assumptions. Root checked its arithmetic and
  the cited AWS billing terms. It is not measured production cost or a guarantee.
- The final production web build passed with a synthetic publishable test key
  and no live authentication. All **36 combined browser cases** passed in 1.5
  minutes at 1440px and 375px, covering current flows, targeting and monitoring.
  All four integrated monitoring screenshots were visually inspected and copied
  over the earlier lane captures; they now include the final navigation and
  corrected notification introduction. Monitoring panels are element crops;
  notification captures are full-page true PNGs. Existing CSS warnings remain.
- The 16 mocked Clerk cleanup-safety tests and TypeScript checking passed.

## Required before the combined implementation is ready

- Obtain the combined branch's required CI results. PR #169's green CI is
  separate evidence from the completed local integration checks.
- Before pilot activation, validate PostgreSQL transactions and migrations on a
  disposable database, and constrain the actual image to 0.25 vCPU/0.5 GB while
  measuring image startup, representative feeds, database latency and memory.
  No Docker or PostgreSQL executable was found on this host's current PATH.
- Validate every cost assumption against the selected pilot cohort and actual
  routing; keep deployment disabled if the complete estimate exceeds $10/month.
- Local fixture checks do not verify Clerk, live provider integration, deployed
  behavior, or inbox delivery. Review hosted results within those limits.
- Select or revise the rune-aligned identity direction and page hierarchy after
  reviewing round 02. This does not block functional repairs.

## Independent review and first combined CI

Draft PR #170 is stacked on PR #169. Run `33341545444` on `a417889` passed
backend, web build, extension and mobile browser jobs. Web E2E passed 39 tests
and failed one because its notification-hour locator still used the old label.
The integration fix uses `Brief and digest hour` and first asserts the control
is visible before checking that disabling email hides it. This was a test
failure, not a runner-start or billing restriction. No manual rerun was requested.

Independent targeting review then reproduced two metadata defects and one
canonical source-association defect. They are now integrated; the previous
496-test result is historical evidence, separate from the follow-up run below.

- `300bf8a` integrates shared visible department/team-name extraction. Matching
  and material fingerprints now use normalized labels, ignoring IDs, casing,
  order and bookkeeping. A department-only match earns the single +10 bonus with
  an explicit explanation. Office metadata remains location information.
  All 58 focused native integration tests passed, including the controlled
  monitoring regression. The integration version requires the monitoring module
  rather than skipping its regression when the module is absent.
- `6cf6244` integrates source-specific Job associations and representative score
  evidence, including qualifying nonrepresentative sources and captured jobs.
  Canonical IDs and application/opportunity workflow history remain unchanged.
- An additional root reproduction found unchanged duplicate sources could send
  again in a later five-minute cycle. Preparation now consults durable delivery
  history under the existing atomic user lease. Already sent, sending, ambiguous
  or terminally failed content is suppressed across associated source IDs.
  Pending/retrying content joins its existing summary without resetting attempts.
  Actual content changes, unrelated companies and other users remain independent.
- `339ac69` integrates the corrected identity package: three rune-aligned raster
  boards, 24 candidate screen studies and eight current-style controls. Both
  package validators passed. The lane inspected every visual; root independently
  reviewed the boards and representative desktop/mobile views, including the
  pending-sensitive-field and disabled-approval application review. Stave is the
  next alignment reference, not a selected production identity. Edition stays
  withdrawn, and the 40-route proposal awaits a hierarchy decision.

## Final local follow-up validation

- All **533 backend tests passed in 59.16 seconds** on the combined department,
  source-identity and later-cycle duplicate suppression code. Existing Python
  datetime and Starlette deprecation warnings remain; no tests were skipped.
- Full repository Ruff, Python compilation and TypeScript checks passed. The
  revision-02 validator's import spacing was corrected for the full CI lint scope.
- All **36 isolated browser tests passed again in 2.4 minutes** on the final
  integrated UI at 1440px and 375px. These cover flow recovery, keyboard access,
  profile round trips and monitoring preferences with synthetic APIs. No Clerk
  global setup, live sender or real application submission was invoked.
- The final controlled measurement completed all three cycles with exactly ten
  mock requests each, zero feed errors, and 0/0/100 events. Wall times were
  67.211/0.666/14.691 seconds while the local browser suite ran concurrently.
  See [final measurement](monitoring-benchmark-final.json). There were no external
  requests or sends. These variable developer-host timings reinforce the need
  for the CPU-limited image/PostgreSQL gate; they do not establish cloud latency.
- Canonical checkout status was rechecked: its original branch/commit, three
  unrelated copyright modifications and untracked files remain untouched.

## Deployment boundary

Monitoring must remain disabled pending the controlled validation and complete
cost estimate. The global pilot is capped at five profiles and ten boards, with
a $10/month incremental ceiling. No new NAT gateway, database service, paid
search provider, or always-running worker is authorized. SES verification and
production-access requirements remain external setup gates; no live sending is
claimed by these tests. Subscription pricing, production authentication, push
credentials and application-submission behavior remain unchanged.
