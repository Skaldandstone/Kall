# Kall production readiness

Updated 2 September 2026. This is the release contract for the first Kall
production candidate. It is invitation-only. The source now supports isolated
live Stripe and Clerk production credentials, but provider activation is still
disabled until the acceptance gates below pass. Automatic tax, SES sending,
continuous monitoring, public signup, and application auto-submission remain
disabled.

## Current state

The production stack is standing in AWS project `734702670689`, selected Region
`us-east-2`, at `https://kall.skaldandstone.com`. The API and web services are
healthy, the database is PostgreSQL 16.15, and CloudFront-to-ALB plus
web-to-API TLS paths passed the hosted smoke checks. Live Stripe, automatic tax,
SES sending, continuous monitoring and public signup remain disabled.

The exact `83309deeec03a8b22ea2c34a1089e6c9d3823911` release commit passed all
five CI jobs. Its rebuilt web image
`sha256:bc0399a4878bc4ce31373d066121bfbac8f9327f4201f7ddc38ea64846587829`
passed ECR Basic scanning with zero findings. The production Clerk custom origin
is present in the web CSP. An invitation for `james@skaldandstone.com` was
accepted through Google OAuth, the authenticated Kall dashboard and billing
screen loaded, and the application created the local Kall user. The billing
screen correctly remained fail-closed while Stripe was disabled. This proves
the invited production sign-in and BFF path for that user, not MFA recovery or
account deletion.

Production startup now fails closed unless all of the following are true:

- PostgreSQL uses `verify-full` with a readable CA bundle;
- signing and sensitive-data encryption keys are distinct and at least 32
  characters;
- Clerk uses a production secret and the token verifier includes the production
  frontend in its authorized-party allowlist;
- the frontend is a credential-free HTTPS origin;
- Alembic owns schema changes and automatic table creation is off;
- durable S3 document storage is configured in the selected Region `us-east-2`;
- signup remains invitation-only;
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

- 642 backend tests passed, including matching live-mode Checkout, webhook,
  entitlement, Clerk-origin, and key-environment regressions;
- full Ruff and Python compilation passed;
- the web lockfile install, production build, TypeScript check, and production
  dependency audit passed with zero findings;
- 23 extension unit tests, 12 extension browser tests, and the bundle build
  passed; the production audit reports 14 moderate upstream findings and no high
  or critical finding;
- mobile TypeScript passed; the production audit reports 29 moderate upstream
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

1. Confirm credit and spend-limit status in AWS Settings > Billing before the
   first cost-bearing change set. The AWS API confirms the $100 monthly budget,
   but the new-experience plan-state endpoint returns no project data.
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
