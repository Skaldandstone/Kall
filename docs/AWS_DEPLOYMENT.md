# Kall AWS deployment

Kall's previous AWS runtime and GitHub-to-CodeBuild deployment path are retired.
Do not use old account-specific buckets, CodeBuild projects, ECS services, or
long-lived GitHub AWS credentials from repository history.

The replacement development project is `734702670689` in the selected Region
`us-east-2`. It currently contains the reviewed private build and storage
foundation plus retained recovery evidence. Kall has no approved running
runtime or public application endpoint.

## Current deployment contract

Application deployment is owned by the designated AWS task and uses reviewed
CloudFormation change sets. GitHub workflows build and test source only. They do
not hold AWS deployment credentials, upload source archives, start CodeBuild, or
update ECS services.

The replacement runtime must preserve all of these constraints:

- deploy an immutable image built from the exact reviewed `main` commit;
- pin the Python and Node bases by digest and require the exact reviewed OpenSSL
  package version through the fail-closed container build gate;
- fail the image scan gate before any runtime is created;
- use the nonroot, read-only API and web images;
- run Alembic once with a dedicated migrator credential, then run Uvicorn alone;
- create services at desired count zero, bootstrap exact database roles with the
  managed-master secret in a one-shot task, verify the Alembic head with the
  migrator, and require a second reviewed change set before desired count one;
- verify the RDS hostname with the checked-in `us-east-2` CA bundle;
- keep RDS private and use separate runtime and migrator database roles;
- route `/api/kall/*` through the authenticated web proxy before routing
  `/api/*` to the bearer-authenticated API used by mobile and the extension;
- use `kall.skaldandstone.com` as the public CloudFront alias with an exact
  `us-east-1` ACM viewer certificate;
- use HTTPS from CloudFront to the ALB and from the web service to the API;
- make the server-side web proxy call the public CloudFront alias, not the
  internet-facing ALB's public addresses or a broadened ALB ingress rule;
- leave the authoritative Cloudflare zone outside the stack, expose the ALB DNS
  output for the DNS-only `origin.kall.skaldandstone.com` CNAME, and require the
  matching `us-east-2` ACM origin certificate while Cloudflare maps the public
  alias to the distribution;
- reference retained application secrets without printing or recreating values;
- keep Stripe live mode, automatic tax, monitoring, SES sending, and public
  invitations disabled until their separate acceptance gates pass;
- attach the bounded two-hour expiry controller and preserve final database
  snapshot, secret, and log retention.

The source template is [infrastructure/kall-alpha.yaml](../infrastructure/kall-alpha.yaml).
The bounded-session controls are in
[infrastructure/alpha-session](../infrastructure/alpha-session/README.md).
Current provider and release gates are recorded in
[provider readiness](continuation/provider-readiness.md),
[runtime image remediation](continuation/runtime-image-remediation.md),
[billing security](continuation/billing-security.md), and
[monitoring](continuation/monitoring.md).

## Release sequence

1. Seal the exact current source and build new API and web images through the
   replacement project's private build jobs.
2. Record immutable digests and complete the reviewed image scan gate.
3. Validate the CloudFormation template with cfn-lint, cfn-guard, AWS template
   validation, and a reviewable change set. Local cfn-lint may ignore only its
   documented stale-schema E3691 for the live-verified PostgreSQL 16.15 version.
4. Provision one bounded alpha session with application desired counts at zero.
   Run and verify the database-role bootstrap, run and verify the migrator task,
   then review a second change set that enables the API and web services.
5. Verify TLS, proxy routing, health, Clerk allowlist behavior, storage,
   application safeguards, cost, and automatic expiry.
   `/api/kall/health` is the one public BFF probe; it forwards only to the
   backend's public health response. Every application route under
   `/api/kall/*` remains Clerk-protected.
6. Configure and test Stripe sandbox, monitoring, SES, and optional OpenAI one
   at a time. None is enabled merely because the base runtime is healthy.
7. Tear down the session on schedule and verify retained recovery artifacts and
   measured cost before another session is approved.

The current manual GitHub workflow is intentionally build-only. A successful
workflow run is source-build evidence, not deployment or hosted acceptance.
