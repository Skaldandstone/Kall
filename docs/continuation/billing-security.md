# Kall billing security evidence

Updated 2026-08-31. Integration owner task
`01a0546e-37c4-78a3-8731-d26b2350af10`, working on
`codex/kall-billing-isolation` in the existing continuation worktree.
Reused the previously isolated `a241077` patch as `4677100`; the original
Stripe worktree is untouched. No new task or cloud resource was created.

## Confirmed defects repaired

- Metadata/unknown-price fallback could grant Plus. Only current configured
  Price/Product pairs now grant Plus or Premium; ambiguous purchases grant Free.
- Customer-only invoice recovery could cross product boundaries. Dedicated
  customer binding, Kall/environment metadata, current subscription ownership
  and current-invoice checks now precede every entitlement change.
- Checkout did not reliably reuse an owned customer or persisted purchase
  attempt. Creation now uses durable idempotency keys and expiring fenced leases.
- Event arrival order could overwrite newer subscription state. Reconciliation
  retrieves current provider state and protects replacement subscriptions.
- Grace scans could undo a concurrent recovery. Downgrade uses a conditional
  write that rechecks the unpaid deadline under the database write lock.
- Checkout returned to nonexistent `/billing/success`; it now returns to the
  existing `/billing` page without treating a URL parameter as payment proof.
- The plans UI had no portal action, no disabled availability state and claimed
  that nothing was charged after ambiguous errors. It now exposes safe recovery,
  status, refresh and an owned customer-portal action. Existing prices remain.

## Checks actually run

Commands from the continuation worktree with `APP_ENV=test` and
`DATABASE_URL=sqlite:///./kall.db`, using the isolated `.venv/Scripts/python.exe`:

- Full `python -m pytest -q --disable-warnings --tb=short`: **587 passed** in
  101.03 seconds. Existing datetime/Starlette warnings remain. No skips/failures.
- After moving blocking webhook reconciliation off the ASGI loop, the final
  billing subset passed **71 tests** in 11.47 seconds. Files: `test_billing.py`,
  `test_billing_plan_mapping.py`, `test_billing_migrations.py`,
  `test_billing_webhook_retries.py`, `test_stripe_isolation.py`, and
  `test_payment_grace_period.py`.
- Full repository Ruff, Python compilation and `git diff --check` passed.
- `npx tsc --noEmit --incremental false` passed in `apps/web`.
- With `KALL_UI_PORT=3357`, `npx playwright test --config
  playwright.usability.config.ts flow.spec.ts functional-areas.spec.ts
  monitoring.spec.ts billing.spec.ts`: **42 passed** in 1.4 minutes. These are
  synthetic API fixtures, without Clerk global setup or real account mutation.
- Six billing-only desktop/mobile cases passed again on the final billing UI
  before its screenshots were retained. Four true PNGs in
  [billing-screenshots](billing-screenshots) were opened and visually inspected
  at 1440px and 375px after font readiness and loaded-state assertions. Fixed
  disabled-button appearance, undefined foreground tokens and action spacing.

The tests cover real raw-body SDK signature verification, expiry/tampering,
live/Connect rejection, price and owner isolation, scoped portal catalogs,
unknown/legacy customers, private error/receipt handling, ambiguous creation
retries, concurrent SQLite delivery, expired lease fencing, transaction rollback,
same-second/out-of-order events, cancellation/re-subscription, current invoice
ownership, grace expiry/recovery and cross-user isolation. One transport-mocked
test uses the actual Stripe 15.6 client to verify API version/idempotency headers,
form encoding and nested response conversion; no Stripe HTTP request is sent.

Migration tests create a fresh SQLite schema, exercise downgrade/re-upgrade and
preserve existing paid users/customer IDs without silently trusting their old
bindings. Existing monitoring weekday migration and foreign-key account deletion
tests also pass in the full suite.

## Failures found during implementation

- Five first-pass webhook tests exposed use of the old SDK conversion method.
  Stripe 15.6 uses `to_dict()`; all were fixed and rerun.
- The new raw migration assertion expected lowercase User.plan, while the
  existing SQLAlchemy enum stores `PREMIUM`. The assertion now verifies the
  correct stored value without modifying legacy data.
- Initial visual captures showed disabled controls looking enabled and touching
  action buttons. CSS was corrected and the final capture set replaced them.

## Remaining release gates

Stripe connector reauthentication is an external blocker. No real catalog,
Customer, Checkout, portal, event destination, card, refund or hosted transaction
was exercised. `STRIPE_ENABLED=false` remains the default; live keys and live
mode remain hard-blocked. No secrets were read or written. Tax stays explicitly
off and no tax registrations/readiness are claimed.

Disposable PostgreSQL migration/concurrency and real sandbox purchase/portal/
decline/recovery tests remain required. Existing customer adoption and expired
ambiguous attempts require deliberate owner reconciliation. Before any live
launch, decide and validate the relationship between account closure, ongoing
subscriptions, provider retention and refunds; this work does not silently
cancel Stripe subscriptions or change account-deletion policy.

The current GitHub policy is manual-only builds/deployments. Historical green
CI for PRs 169/170 is not evidence for newer heads, and no workflow was enabled
or dispatched during these tests. See the continuation register for current PR
reconciliation status. Monitoring, SES, production Clerk, application submission
and cloud cost/latency holds remain unchanged. Inscription is selected; broader
screen and navigation proposals still need their separate review.

Setup and exact owner steps: [Stripe setup](../STRIPE_SETUP.md).
