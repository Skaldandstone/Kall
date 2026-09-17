# Kall production readiness

> **Account migration 2026-09-07:** Kall production now runs in the Skald and Stone management account `051722405355` (stack `kall-production`, cluster `skaldandstone-production`, ECR `kall-api`/`kall-web`, CloudFront `E2HHZUTE7F4UDE`). Account `734702670689` is retired. Any `734702670689` reference below is historical.

Updated 8 September 2026. This is the release contract for the first Kall
production candidate. Production Clerk and the isolated live Stripe catalog are
configured and live. SES production sending and scheduled notification delivery
are enabled. Native Apple/Google billing, automatic tax, and application
auto-submission remain disabled. Public
signup is enabled and remains an explicit deployment parameter.

## Current state

`https://kall.skaldandstone.com` is healthy on `kall-production` in AWS project
`051722405355`, selected Region `us-east-2`. PostgreSQL 16.15 is private and
Multi-AZ. CloudFront-to-ALB and web-to-API TLS paths pass hosted smoke checks.
Live Stripe uses the Kall-only catalog, restricted key, portal configuration,
and webhook destination. No controlled live charge or refund has been performed.

> **16 September 2026, API+web release + live Stripe repricing:** source
> commit `4163b2eb44712ddc8ecb35dd9e153798876f3ae8` (SSE-206: Plus/Premium
> repriced to $9/$25, Free's AI surface cut to effectively zero -- growth
> plans, skills analysis, resume strategy, and interview prep/quiz grading
> now require Plus outright; profile-field chips go rules-based on Free;
> a regression this surfaced -- dropping Free's ai_actions allowance to
> zero would have blocked Free from creating any tailoring proposal, not
> just its AI wording -- was fixed by threading an ai_allowed flag through
> so tailoring degrades to rules-based wording instead of refusing
> outright). Green CI on this exact commit. Reviewed-snapshot manifest
> `fdc9a6ddb620853ebfaa770192f0837ebc118b563b5397cd2e3cfd94e133752c`,
> built via `kall-api-build`/`kall-web-build` with source, manifest hash,
> image tag (`release-4163b2e`), and a corrected buildspec override all
> overridden per-build. New API image
> `sha256:6141bc4a81f5ab6edc61c9b4dff77952d72d95e9a0122b7f00fbc455d15b2eac`,
> new web image
> `sha256:8b89af2969684c04036dd8c2eb814f3641a290fb7b1ccad79494de3fa6ddd84f`,
> both ECR Basic scans completed with zero findings. No schema change --
> `VerifiedMigrationHead` stays `20260914_0036`.
>
> Before this release, confirmed zero active/trialing/past-due
> subscriptions on the live Kall Stripe account (`acct_1U9JeKLDE8FHWLmd`,
> via the newly-authenticated Stripe connector) -- no grandfathering or
> price-increase notice was needed. Created new live Price objects on the
> existing Plus/Premium Products (`price_1UGRZALDE8FHWLmdffpdMpwZ` at
> $9.00/mo, `price_1UGRZhLDE8FHWLmdhgzXGPfP` at $25.00/mo) and set each as
> its product's default price; the old prices
> (`price_1UB0nkLDE8FHWLmdAPU6aofY`, `price_1UB0njLDE8FHWLmdmDCbWyPx`)
> were left active rather than archived immediately, in case of a rollback.
> Deliberately did **not** execute a Stripe-price-only change set ahead of
> the code -- the currently-deployed API image already reads
> `StripePlusPriceId`/`StripePremiumPriceId` for checkout, so shipping the
> price change alone first would have charged the new amounts while the
> site still displayed the old $5/$15 copy. Change set `release-4163b2e`
> bundled `ApiImage`/`WebImage` and the two Stripe price parameters
> together so displayed and charged price move in lockstep; every other
> parameter carried `UsePreviousValue`, and all 10 changed resources were
> in-place `Modify`s, same shape as every prior release this week.
> Executed by James. Post-release: stack `UPDATE_COMPLETE`, and the public
> root, `/api/health`, and `/api/kall/health` all return 200.
>
> **17 September 2026**: confirmed the release healthy (root/`/api/health`
> both 200) and archived both old Stripe prices
> (`price_1UB0nkLDE8FHWLmdAPU6aofY` at $5.00/mo,
> `price_1UB0njLDE8FHWLmdmDCbWyPx` at $15.00/mo) via the Stripe connector
> (`active: false`) -- no new checkout can select them; only the new
> $9/$25 prices remain active on the Plus/Premium products.
>
> **Still outstanding for this repricing**: Google Play and App Store
> Connect subscription prices are unchanged ($4.99/$14.99) -- those need
> to be updated directly in each console; RevenueCat only reflects
> whatever price is set there, it does not originate a price change.

> **16 September 2026, API+web release:** source commit
> `c48061ce0d6640e1757ff85497bf6ebe128f0c17` (resume upload limit raised
> 15MB -> 25MB across backend and both mobile screens, and the web
> career-strategy resume upload now surfaces the backend's actual
> rejection reason instead of a generic failure message -- traced from a
> friend's mobile upload failing with no server-side trace, which
> correctly pointed at the client-side size check rejecting before any
> request was sent). Green CI on this exact commit. Reviewed-snapshot
> manifest `583b323c38801453c2714a894a6ba05c9326d0920172a516bdf33117f9a4a854`,
> built via `kall-api-build`/`kall-web-build` with source, manifest hash,
> image tag (`release-c48061c`), and a corrected buildspec override all
> overridden per-build. New API image
> `sha256:869321dc46f2dca08f4668306f36e8c7e907c2d1aded7a973338f78dce361e51`,
> new web image
> `sha256:883b5580ccf9ee23250e39c650d7380cd4a8adadc6332ee5b174b252f75b3320`,
> both ECR Basic scans completed with zero findings. No schema change --
> `VerifiedMigrationHead` stays `20260914_0036`. Change set
> `release-c48061c` on `kall-production` verified before execution: all
> 10 changed resources were in-place `Modify`s (`ApiService`/`WebService`
> and their task definitions, plus the job-runner task definition and
> scheduler resources that also reference the API image); every parameter
> besides `ApiImage`/`WebImage` carried `UsePreviousValue`. Executed by
> James. Post-release: stack `UPDATE_COMPLETE`, and the public root,
> `/api/health`, and `/api/kall/health` all return 200.

> **13 September 2026, SES production acceptance:** AWS granted production
> access in project `051722405355`, selected Region `us-east-2`. Live checks
> report sending enabled, healthy enforcement, a 50,000-message daily quota,
> and a 14-message-per-second rate. The stack supplies the verified sender
> `support@skaldandstone.com` to the scheduled job runner. Account-level
> suppression automatically records both hard bounces and complaints; the
> suppression list was empty at verification time. A send to the official SES
> success simulator returned a provider message ID and did not contact a real
> recipient or count against the quota. Inbox delivery to a consenting Kall
> user remains a separate acceptance check.

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

> **14 September 2026, API+web release:** source commit
> `a94b70206e7584e616b50fc9a3fd589f88ffa8dc` (the RENDER_VERSION
> cache-invalidation fix from the release below, plus
> `POST /applications/{id}/restart-tailoring` -- a way to discard an
> in-progress or already-finalized tailoring/cover-letter/document review
> and start a fresh proposal, reached from a "Start over" control on the
> review panel at any phase, not just after picking a look). Green CI on
> this exact commit. Reviewed-snapshot manifest
> `a980fb23ba07bf5aa1652249dc25ab531a2af2930940ef8bddc37e80409aee23`, built
> via `kall-api-build`/`kall-web-build` with source, manifest hash, image
> tag (`release-a94b702`), and a corrected buildspec override (the
> persisted buildspec's embedded expected-commit check is a full release
> behind, `692b558`, since a buildspec override never mutates the stored
> project config) all overridden per-build. New API image
> `sha256:ce0e33bccee6fc372d01cbcadd4a21ba2a4debc529bc78d17a65cd3f5f6d1bc0`,
> new web image
> `sha256:e1ec29d40c49c377bc86ce7e440c15847cb1daa7b5dfd9f211535cbb85dbffb4`,
> both ECR Basic scans completed with zero findings. No schema change --
> `VerifiedMigrationHead` stays `20260914_0036`. Change set `release-a94b702`
> verified before execution: every changed resource was an in-place
> `Modify`, same shape as every prior release this week; every parameter
> besides `ApiImage`/`WebImage` carried `UsePreviousValue`. Executed by
> James. Post-release: stack `UPDATE_COMPLETE`, both services 1/1 with a
> single `PRIMARY` deployment each and `rolloutState: COMPLETED`, and the
> public root, `/api/health`, and `/api/kall/health` all return 200.

> **15 September 2026, API+web release:** source commit
> `acaec7d8bc68446425ba7813dd2f03311f5695ce` (experience-wording alignment
> suggestions for accounts with no structured Employment record, and the
> "Start over" control ported to mobile -- both traced from a real
> account's tailored resume that came back with only a summary; earlier
> commits in the same push already fixed the word-per-line reflow bug
> that caused it). Green CI on this exact commit (backend, web, e2e,
> accessibility, mobile-e2e). Local mobile validation also clean:
> `tsc --noEmit`, `validate:ios-alpha`, `validate:android-play`,
> `validate:android-native`, and `expo-doctor` (21/21) -- no EAS build
> triggered. Reviewed-snapshot manifest
> `1507dc8bd2e54cf946e5c6d47d34ab0f8b8c7ab380c85a03b63239a2186ec93b`, built
> via `kall-api-build`/`kall-web-build` with source, manifest hash, image
> tag (`release-acaec7d`), and a corrected buildspec override all
> overridden per-build. New API image
> `sha256:5d56270685428488820d119ed892fefef10a10139ba4aee180901dc4b0bbd317`,
> new web image
> `sha256:a5c6913e93f7cc6b1bc3dc721f429a8c928e43f02e6516f7201ccaf6a595b059`,
> both ECR Basic scans completed with zero findings. No schema change --
> `VerifiedMigrationHead` stays `20260914_0036`. Change set
> `release-acaec7d` on `kall-production` verified before execution: every
> changed resource is an in-place `Modify`, same shape as every prior
> release this week; every parameter besides `ApiImage`/`WebImage` carried
> `UsePreviousValue`. This change set's images already included the
> earlier `release-2887b3c` reflow fix (same commit history, superseding
> build) -- that change set was deleted rather than left pending
> alongside this one. Executed by James. Post-release: stack
> `UPDATE_COMPLETE`, both services 1/1 with a single `PRIMARY` deployment
> each and `rolloutState: COMPLETED`, and the public root, `/api/health`,
> and `/api/kall/health` all return 200.

> **14 September 2026, API+web release:** source commit
> `408779575c7ce02e7dcf61ffe9c4992059ef61cf` (guided-tailoring wording
> customization, the resume section-heading parser fix, a maintenance
> banner for a rolling deploy, and the ATS-template-standards writeup;
> earlier commits in the same push added email integration and its mobile
> UI). Green CI on this exact commit. Reviewed-snapshot manifest
> `eb5975ae72847bd5d995cbfe3f73a80f60c3ba3d1403dcd985499fc38c203434`, built
> via `kall-api-build`/`kall-web-build` CodeBuild runs with the source,
> manifest hash, image tag (`release-4087795`), and buildspec (only the
> embedded expected-commit check line differs from the persisted baseline)
> all overridden per-build, so the projects' stored configuration still
> reflects their original reviewed baseline. New API image
> `sha256:4152774cdb9a2f9aade84abdfa464e6cc3ca2d0a051b1bbd902f158b865604a0`,
> new web image
> `sha256:8ad2f4c0f50340d9da24b020aef688d7d7f04da5065ef3322114ffd16b619078`,
> both ECR Basic scans completed with zero findings. No schema change in
> this release -- `VerifiedMigrationHead` stays `20260914_0036`, so no
> migration task ran first. Change set `release-4087795` on
> `kall-production` verified before execution: every changed resource was an
> in-place `Modify` (`ApiService`/`WebService` and their task definitions,
> plus the job-runner task definition and scheduler resources that also
> reference the API image); nothing was added or removed, and every
> parameter besides `ApiImage`/`WebImage` carried `UsePreviousValue`.
> Executed by James. Post-release: stack `UPDATE_COMPLETE`, both services
> 1/1 with a single `PRIMARY` deployment each and `rolloutState:
> COMPLETED`, and the public root, `/api/health`, and `/api/kall/health`
> all return 200.
>
> A same-day follow-up commit (`0857137`, after this release was already
> live) versions the document/preview cache key by a new `RENDER_VERSION`
> constant, to fix a document generated before a rendering bug fix
> serving its pre-fix bytes forever. Shipped in the `a94b702` release
> below.

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
