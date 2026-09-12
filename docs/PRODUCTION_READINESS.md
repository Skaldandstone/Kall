# Kall production readiness

> **Account migration 2026-09-07:** Kall production now runs in the Skald and Stone management account `051722405355` (stack `kall-production`, cluster `skaldandstone-production`, ECR `kall-api`/`kall-web`, CloudFront `E2HHZUTE7F4UDE`). Account `734702670689` is retired. Any `734702670689` reference below is historical.

Updated 8 September 2026. This is the release contract for the first Kall
production candidate. Production Clerk and the isolated live Stripe catalog are
configured and live. Native Apple/Google billing, automatic tax, SES sending,
continuous monitoring, and application auto-submission remain disabled. Public
signup is enabled and remains an explicit deployment parameter.

## Current state

`https://kall.skaldandstone.com` is healthy on `kall-production` in AWS project
`051722405355`, selected Region `us-east-2`. PostgreSQL 16.15 is private and
Multi-AZ. CloudFront-to-ALB and web-to-API TLS paths pass hosted smoke checks.
Live Stripe uses the Kall-only catalog, restricted key, portal configuration,
and webhook destination. No controlled live charge or refund has been performed.

The 8 September parity release is source commit `1b8c8229398484674082b74fd846df3ed936e189`;
commit `4b568ef472a53ad83eb9d8a7d61df68b0877e408` adds only the reviewed-snapshot
packaging safeguard. The exact archived source manifest is
`53c9a299e5fdd1802e54218687a88c0915029156d28573501e7310d4e0dde383`.
The deployed API image is
`sha256:2cacfebfd42f09eb577ea6c6c01bf3e8b76078dc551ef21ff75ddede532be554`;
the deployed web image is
`sha256:d2934a9241d47721bd1cef1fa0d9ab34d65dc2851f1b2c62af1e7c49ce5dfc16`.
Both ECR Basic scans completed with zero findings. The one-shot migration task
exited zero and logged verified Alembic head `20260908_0034`. The next release
must run and record current head `20260909_0035` before enabling its services. Both services are
1/1, both target groups are healthy, all six Kall production alarms are `OK`,
and the public root, both health routes, and mobile release manifest return 200.
RevenueCat remains fail-closed with its webhook returning 404 until store
catalogs, credentials, and sandbox acceptance are complete.

> **12 September 2026, web-only release:** the deployed web image and
> `WebImage` parameter were out of date here even before this release (the
> live stack had already moved to `sha256:ac4396bba34cd9173a51ee5dd1ce55c318a221557db146249db1e8c7c80bdef2`
> by an earlier, undocumented update) - this doc's digests above are historical,
> not current. This release is source commit `8edc4ae0cafba3302142eb98daca91c626a048fa`
> (shrinks the trademark mark in the authenticated app nav to a small
> superscript, matching the fix already shipped on the Studio, Vaettir, and
> Savortome web frontends); reviewed-snapshot manifest
> `454019fea20b89dfe15e9914f5394277649fe0d05ed41cc6a0eeb8ede054f502`. Built via
> a `kall-web-build` CodeBuild run with the source, manifest hash, and image
> tag (`release-8edc4ae`) all overridden per-build rather than mutating the
> project's stored configuration, so its persisted `SOURCE_SHA256` still
> reflects its original reviewed baseline. New web image
> `sha256:a88a4c2c87206ae716e9a6848463882344d4c75d246ec56a4725907d514b01ba`,
> ECR Basic scan completed with zero findings. Applied through a CloudFormation
> change set on `kall-production` touching only the `WebImage` parameter -
> `WebTaskDefinition` (new revision) and `WebService` (points at it) were the
> only two resources in the change set, confirmed before executing. The API
> image, migrations, secrets, and every other parameter were left untouched
> (`UsePreviousValue`). Post-release: stack `UPDATE_COMPLETE`, both target
> groups healthy, public root and `/api/kall/health` both return 200.

Production startup now fails closed unless all of the following are true:

- PostgreSQL uses `verify-full` with a readable CA bundle;
- signing and sensitive-data encryption keys are distinct and at least 32
  characters;
- Clerk uses a production secret and the token verifier includes the production
  frontend in its authorized-party allowlist;
- the frontend is a credential-free HTTPS origin;
- Alembic owns schema changes and automatic table creation is off;
- durable S3 document storage is configured in the selected Region `us-east-2`;
- signup matches the reviewed deployment parameter and release policy;
- any enabled Stripe environment has a matching test or live key, complete
  Kall-only catalog, portal, signing secret, and environment-specific scope;
- live Stripe uses exactly `kall:production`, while sandbox objects cannot use
  that scope; and
- the production web image is built with a Clerk production publishable key and
  `KALL_CLERK_INSTANCE=production`.

The ALB API target uses `/ready`, which verifies database connectivity. The
container's own `/health` probe remains a liveness check, allowing operations to
distinguish a dead process from a temporarily unavailable database.

## Source release gate

One CI workflow is the automatic source gate. It runs backend tests and Ruff,
the production web build, authenticated browser tests, extension build/tests,
and mobile browser tests on pull requests and `main`. Package installs use the
committed lockfiles through `npm ci`, under the same Node 24.18.1 runtime used
by the reviewed web container. The manual build workflow remains
credential-free and cannot deploy. The obsolete partial build workflow is
removed so it cannot be re-enabled as a weaker or duplicate required check.

Before sealing images, require a green CI run on the exact release commit and
run locally:

```powershell
Set-Location -LiteralPath C:\Users\James\Documents\GitHub\Kall
python -m ruff check .
python -m compileall -q backend tests scripts migrations infrastructure
python -m pytest -q
cfn-lint -i E3691 -- .\infrastructure\kall-alpha.yaml
Set-Location -LiteralPath .\apps\web
npm ci
npm run build
```

`E3691` is the only local lint exception: the installed cfn-lint schema stops at
PostgreSQL 16.14, while the selected Region and successful sandbox independently
verified RDS PostgreSQL 16.15. Do not ignore another rule or a different engine
version under this exception.

Current local evidence on the production-preparation source:

- 763 backend tests passed, including matching live-mode Checkout, webhook,
  entitlement, Clerk-origin, and key-environment regressions;
- full Ruff and Python compilation passed;
- the web lockfile install, production build, TypeScript check, and production
  dependency audit passed with zero findings;
- 23 extension unit tests, 12 extension browser tests, and the bundle build
  passed; the production audit reports 14 moderate upstream findings and no high
  or critical finding;
- mobile TypeScript, Android/iOS release validators, Expo Doctor 21/21, and an
  Android production export passed; the production audit reports 30 moderate upstream
  findings and no high or critical finding; and
- focused release/configuration tests and CloudFormation lint passed with only
  the documented `E3691` exception.

The extension/mobile moderate findings still require upstream review and do not
prove installed-extension or physical-device acceptance. Do not use an unsafe
forced dependency downgrade merely to make the audit count zero.

The alpha template remains a validated bounded-runtime input and must not be
revived or renamed in place. The separate
[`infrastructure/kall-production.yaml`](../infrastructure/kall-production.yaml)
production template now preserves the proven role, bootstrap, migration, TLS,
and BFF routing contracts while adding production-only retained secrets,
versioned private document storage, 90-day logs, Multi-AZ PostgreSQL, seven-day
backups, deletion protection, alarms, and immutable-image constraints. It
defaults both services and live Stripe to disabled.

The production template passes local CloudFormation lint with only the existing
PostgreSQL 16.15 schema-lag exception, AWS `validate-template` and
`get-template-summary`, and focused security/configuration tests. Its official
price-list model is $73.71 per 730-hour month under the documented low-traffic
assumptions, before credits, taxes, shared-foundation cost, and variable
overages. The AWS project has a $100 monthly budget. This is a planning gate,
not a billing guarantee. See
[`infrastructure/production/README.md`](../infrastructure/production/README.md).

## Required production decisions and provider acceptance

These are external gates and cannot be marked complete by source tests:

1. The new AWS project has a healthy $100 monthly monitoring budget with actual
   and forecast alerts. Confirm its separate spend-limit status in AWS Settings
   > Billing; the new-experience plan-state endpoint returns no project data.
   A budget alerts and reports with lag. It does not stop resources.
2. The initial availability contract is Multi-AZ PostgreSQL 16.15, seven-day
   point-in-time backups, deletion protection, encrypted gp3 with autoscaling to
   100 GiB, and snapshot-on-delete/replace. Schedule and prove a restore after
   the first accepted production backup.
3. Build API and web images from the exact release commit, record immutable
   digests, inspect final files/config, and pass ECR scanning. Basic scanning is
   insufficient if enhanced scanning is required by the release policy.
4. The production Clerk instance, custom domain, DNS, Google OAuth, accepted
   invitation and signed-in BFF flow for `james@skaldandstone.com` are complete.
   Still verify MFA/session policy, account deletion and recovery without
   exposing tokens or cookies.
5. The template creates a dedicated retained production S3 bucket with public
   access blocked, versioning, encryption, and TLS enforcement. After creation,
   verify CloudTrail data-event coverage as approved and perform a synthetic
   upload/read/delete test from the exact task role.
6. Review CloudFront, ACM, Cloudflare DNS, ALB ingress, WAF/rate limits, log
   retention, alarms, paging destination, CloudTrail, budgets, and rollback
   access. Do not broaden ALB ingress to solve internal routing.
7. Review privacy policy, terms, support contact, data retention, account
   closure, backup retention, incident response, and subscription/refund policy
   before inviting anyone outside the controlled cohort.
8. The Kall-only live products, monthly prices and webhook endpoint exist.
   Complete the restricted key, Kall-only portal configuration and production
   vault record, then enable billing through a reviewed stack update. Verify
   hosted Checkout, webhook deduplication, portal changes, decline, cancellation,
   grace and recovery, plus a controlled live payment and refund.
   Exercise SES, monitoring, OpenAI, mobile signing, and the installed extension
   independently. A healthy base runtime enables none of them automatically.
9. Google Play closed-test 1.1.0 build 9 and iOS 1.1.0 build 3 are store-built
   from `1b8c822`. Android is published to the closed track. The iOS build is
   processed, is available to the internal `Team (Expo)` group, and remains
   ready to submit for external TestFlight review. RevenueCat project
   `b4b5bad9`, the Android app shell, Plus/Premium entitlements, and the
   production webhook are configured; its two webhook credentials are stored
   only in the dedicated production secret. Apple Plus and Premium monthly
   subscriptions exist in subscription group `22370361` at USD 4.99 and USD
   14.99 respectively. Native billing remains fail-closed. Activation still
   requires valid Google base plans, completion of the dedicated Play
   service-account connection, product import/offering publication, a
   purchases-enabled rebuild, and physical-device license-test acceptance. Both
   platform public SDK keys are configured in EAS production. Apple additionally
   requires paid-agreement banking/tax/trader information, an App Store Connect
   API key for RevenueCat product import, listing and subscription review
   screenshots, and TestFlight sandbox acceptance. Clerk's iOS registration and
   Apple Services ID exist, but Apple sign-in remains disabled pending safe key
   replacement. See [`NATIVE_BILLING.md`](NATIVE_BILLING.md).

## Deployment sequence

1. Freeze the release commit and require green CI on that exact SHA.
2. Produce reproducible immutable images and complete the scan gate.
3. Review CloudFormation lint, Guard, AWS validation, cost estimate, and a change
   set with application services at zero.
4. Create the private database and storage, bootstrap exact database roles, run
   Alembic with the migrator, and record the verified head.
5. Enable one API and one web task through a second reviewed change set. Require
   deployment circuit-breaker rollback and healthy `/ready` and web targets.
6. Verify HTTPS, security headers, signed-out behavior, direct bearer rejection,
   signed-in BFF ownership, durable storage, application-review safeguards,
   alarms, logs, backups, and restore access.
7. Invite only the controlled cohort. Observe errors, latency, database load,
   storage, email/provider holds, and projected monthly cost before expansion.

## Rollback and stop conditions

Stop rollout and scale application services to zero for an authentication,
ownership, encryption, migration, submission-safeguard, or cross-user isolation
failure. Do not retry ambiguous provider operations blindly.

For an application regression, redeploy the last accepted immutable image. For
a schema regression, prefer forward repair; downgrade only when the migration
has an explicitly tested downgrade and no newer writes make it unsafe. Preserve
database snapshots, logs, secrets, and versioned documents. A destructive
restore or retained-artifact deletion requires a separate reviewed action.

Live billing, automatic tax, public signup, sender activation, monitoring
polling, and application submission each require their own go/no-go record.
Automatic tax stays off until actual registrations and tax treatment are
verified; source support for live payments is not a tax-readiness claim.
