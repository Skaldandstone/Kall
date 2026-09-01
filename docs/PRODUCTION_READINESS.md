# Kall production readiness

Updated 1 September 2026. This is the release contract for the first Kall
production candidate. It is invitation-only. Live Stripe, automatic tax, SES
sending, continuous monitoring, public signup, and application auto-submission
remain disabled until their separate acceptance gates pass.

## Current state

The bounded AWS sandbox proved the hardened API and web images, database-role
bootstrap, Alembic migration, RDS certificate verification, CloudFront-to-ALB
TLS, web-to-API proxy, public health route, signed-out protection, ECS target
health, alarms, and automatic teardown. The final encrypted PostgreSQL 16.15
snapshot is retained. The runtime stack, RDS instance, CloudFront distribution,
ALB, and ECS cluster are absent. This evidence proves the reviewed sandbox path;
it is not a standing production deployment.

Production startup now fails closed unless all of the following are true:

- PostgreSQL uses `verify-full` with a readable CA bundle;
- signing and sensitive-data encryption keys are distinct and at least 32
  characters;
- Clerk is configured;
- the frontend is a credential-free HTTPS origin;
- Alembic owns schema changes and automatic table creation is off;
- durable S3 document storage is configured in the selected Region `us-east-2`;
- signup remains invitation-only;
- live Stripe mode remains off; and
- any enabled Stripe sandbox has the complete Kall-only catalog, portal,
  signing secret, test key, and billing scope.

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

- 637 backend tests passed;
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

The alpha template is a validated bounded-runtime input, not a durable
production stack. Do not remove its expiry controller or rename its resources
in place. A production change set must use separate names and storage, preserve
the same role/bootstrap/migration/TLS contracts, and be reviewed before create.

## Required production decisions and provider acceptance

These are external gates and cannot be marked complete by source tests:

1. Confirm the AWS project is paid and check the spend limit in AWS Settings >
   Billing. Approve a monthly production estimate before creating resources.
2. Choose availability and recovery targets. At minimum decide RDS Multi-AZ,
   backup retention, point-in-time recovery window, deletion protection, storage
   autoscaling, and a restore-test schedule. The alpha's one-day, single-AZ
   database settings are not production defaults.
3. Build API and web images from the exact release commit, record immutable
   digests, inspect final files/config, and pass ECR scanning. Basic scanning is
   insufficient if enhanced scanning is required by the release policy.
4. Verify the production Clerk instance, invitation path, allowed redirect and
   origin domains, MFA/session policy, account deletion, and one signed-in BFF
   request without exposing tokens or cookies.
5. Create a dedicated production S3 bucket with public access blocked,
   versioning, encryption, lifecycle rules, access logging or CloudTrail data
   events as approved, and a synthetic upload/read/delete test from the task
   role.
6. Review CloudFront, ACM, Cloudflare DNS, ALB ingress, WAF/rate limits, log
   retention, alarms, paging destination, CloudTrail, budgets, and rollback
   access. Do not broaden ALB ingress to solve internal routing.
7. Review privacy policy, terms, support contact, data retention, account
   closure, backup retention, incident response, and subscription/refund policy
   before inviting anyone outside the controlled cohort.
8. Exercise Stripe sandbox, SES, monitoring, OpenAI, mobile signing, and the
   installed extension independently. A healthy base runtime enables none of
   them automatically.

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
