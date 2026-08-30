# Continuation integration validation

Working branch: `codex/kall-continuation-integration`. Updated 2026-08-30.
This file records completed checks separately from remaining release gates.

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

## Required before the combined implementation is ready

- Integrate final targeting, notification and UI patches, then rerun the full
  backend suite under the normal local test configuration.
- Validate new migrations both on a fresh database and the pre-monitoring
  schema, preserving existing schedules and workflow states.
- Run controlled-feed monitoring and notification tests with the sender
  disabled. Cover concurrency, expired leases, resume fairness, changed and
  unchanged postings, cross-user isolation, preferences, DST and provider errors.
- Measure runtime and request volume, and record a complete incremental cost
  estimate including network addresses, egress, logs, storage and email.
- Build the combined web app and run relevant browser regressions. Inspect real
  screenshots at desktop and 375px widths. Fixture tests do not verify Clerk,
  live provider integration, deployed behavior, or inbox delivery.
- Review the identity boards and all same-content desktop/mobile mockups.
  Record a recommendation, but do not replace production identity or broader
  navigation without a selected direction.

## Deployment boundary

Monitoring must remain disabled pending the controlled validation and complete
cost estimate. The global pilot is capped at five profiles and ten boards, with
a $10/month incremental ceiling. No new NAT gateway, database service, paid
search provider, or always-running worker is authorized. SES verification and
production-access requirements remain external setup gates; no live sending is
claimed by these tests. Subscription pricing, production authentication, push
credentials and application-submission behavior remain unchanged.
