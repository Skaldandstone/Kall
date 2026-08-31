# Main delivery, 31 August 2026

James authorized reconciling all existing Kall work into main, followed by UI,
AWS, Stripe sandbox and release work, with review at the end. Existing application
submission safeguards, live-payment blocks and budget limits are unchanged.

## Reconciled baseline

Delivery branch starts at current origin/main `22a9fc6`. It preserves the local
documentation reorganization `fed34b5`, the complete reminder/continuation/billing
histories, local image-processing mitigation `313dc51`, and all-pages Inscription
plan `b3d3dfb` (applied as `7d1270b`). The build.yml add/add conflict retains main's
version. No workflow was enabled or dispatched. All three open PR heads are
ancestors of this delivery; no feature history was discarded.

Fresh checks on the combined source:

- 587 backend tests; Ruff and Python compilation passed.
- Production web build and TypeScript passed.
- 42 desktop/mobile synthetic browser flow cases passed; the two optional
  screenshot-only cases were skipped in that run.
- 23 extension unit tests, extension bundle build and 12 DOM cases passed.
- 16 Clerk test-cleanup safety checks passed without provider credentials.
- 90 isolated PostgreSQL contracts passed, with fresh/downgrade/re-upgrade
  migrations and eight-worker ownership/webhook races. Mocked feed benchmark
  passed; no existing Windows database service was changed.
- 17 production loopback image assertions passed: original assets served,
  optimizer refused, no backend requests.
- UI plan inventory: 40 routes, 15 redirects, 35 templates.

These checks do not establish authenticated hosted operation, real Stripe
fulfillment, live email, physical-device behavior or visual acceptance.

## Current external state

The original documented AWS project/CloudFront origin is historical. The newer
foundation is development project `734702670689`, selected Region `us-east-2`.
The separate recovery handoff records foundation/access resources and private
build images, but no runtime services, database or public webhook endpoint.
Local AWS credentials are expired/invalid. CLI sign-in was attempted; selecting
the old Kall project failed, and Google sign-in in Chrome was blocked by the
browser's action approval rule. No authentication bypass was attempted.

The newer Stripe handoff records existing sandbox products, prices, restricted
keys and scoped portals. Kall's vault record is `dev/kall/stripe`; Clerk uses
`dev/kall/clerk`. Reuse these instead of creating duplicates. This delivery has
not retrieved credentials or verified those provider objects itself. Actual
hosted purchase, signed delivery, decline/recovery and portal acceptance remain.

Dependency remediation upgraded the web app to the maintained Next 15.5.25
backport and pinned the patched PostCSS release. The final web production audit
reports zero findings. Extension production dependencies have 14 moderate
upstream findings and no high or critical finding; the only automated fix is an
unsafe Clerk downgrade. Mobile production dependencies have 22 moderate
upstream Expo/Clerk/Solana findings and no high or critical finding, with no safe
automated remediation. Cloud image findings remain unresolved. Live billing and
automatic tax remain disabled.

Source handoffs inspected: the `STRIPE-COMPLETION-STATUS.md` and
`DEV-VALIDATION-HANDOFF.md` files in the 2026-08-31 overnight task's outputs, and
the AWS owner's `aws-development/README.md`. Earlier pending-catalog/foundation
approval notes are superseded by those later records.

## Next delivery

Inscription is now the default shared presentation, with a career-first Brief,
responsive navigation, keyboard skip path, preserved application workflows and
captured desktop/mobile evidence. The final clean synthetic run passed 44 cases
with two opt-in capture cases skipped. Provider activation still requires a safe
Kall runtime, remediated images, a verified origin and authenticated AWS access.
Do not use historical green CI or the old CloudFront hostname as release evidence.
