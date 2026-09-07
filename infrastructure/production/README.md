# Kall production infrastructure

> **Account migration 2026-09-07:** Kall production now runs in the Skald and Stone management account `051722405355` (stack `kall-production`, cluster `skaldandstone-production`, ECR `kall-api`/`kall-web`, CloudFront `E2HHZUTE7F4UDE`). Account `734702670689` is retired. Any `734702670689` reference below is historical.

`../kall-production.yaml` is a separate durable production stack. It does not
modify or revive the expiring alpha runtime. Regional resources stay in the
selected Region `us-east-2` and AWS project `051722405355`; Cloudflare continues
to own public DNS.

The stack creates retained production-only signing, sensitive-data, runtime
database, and migration database secrets. It accepts externally managed
production Clerk and invitation-access secret ARNs. The live Stripe secret uses
a non-existent sentinel while billing is disabled. Secret values never belong
in parameters, source archives, build logs, or change-set output.

The initial stack must use `EnableApplicationServices=false` and
`EnableStripeLive=false`. This creates the durable data, routing, task
definitions, and observability layer with no running application tasks. Run the
exported bootstrap task once, then the migration task once, and verify exact
records `kall-db-roles-v1` and `20260905_0032`. Only a second reviewed change
set may record that evidence and enable the two services.

Production data uses a private encrypted Multi-AZ PostgreSQL 16.15 instance,
seven-day backups, deletion protection, and snapshot-on-delete/replace. Private
documents use an encrypted, versioned, public-blocked S3 bucket with TLS
enforcement. Those resources, generated secrets, logs, and CloudFront are
retained across accidental stack deletion or replacement.

The source gate is:

```powershell
Set-Location -LiteralPath C:\Users\James\Documents\GitHub\Kall
cfn-lint -i E3691 -- .\infrastructure\kall-production.yaml
& '<reviewed-cfn-guard-3.2.1-path>\cfn-guard.exe' validate --rules .\infrastructure\production\kall-production.guard --data .\infrastructure\kall-production.yaml
aws cloudformation validate-template --profile kall-production --region us-east-2 --template-body file://infrastructure/kall-production.yaml
python -m pytest -q tests/test_production_infrastructure.py infrastructure/production/test_cost_model.py
python .\infrastructure\production\cost_model.py
```

`E3691` remains limited to local `cfn-lint` 1.55.1 lagging the AWS-supported
PostgreSQL 16.15 engine value. Do not ignore another finding.

The deterministic low-traffic model is **$73.71 per 730-hour month** before
credits and taxes. It assumes two continuously running 0.25 vCPU/0.5 GB tasks,
Multi-AZ `db.t4g.micro`, 20 GiB gp3, one ALB and one average LCU, six secrets,
six alarms, 1 GiB logs, 5 GiB documents, 10 GiB CloudFront data out, and one
million HTTPS requests. It excludes request charges,
snapshot growth, provider fees, email, AI, monitoring, WAF, and traffic above
those assumptions. The AWS project has a $100 monthly monitoring budget, so review
project-wide usage and credits in AWS Settings > Billing before executing the
production change set. The budget sends alerts but does not stop resources or
replace a project spend limit.

Public signup is a parameter, not a code change. `EnablePublicSignup` defaults to
`false`, which keeps `ALPHA_INVITE_ONLY=true` in all three task definitions (API,
migration, web). Setting it to `true` only relaxes Kall's own gate; self-service
sign-up must also be enabled in the production Clerk instance before anyone can
actually register. The invitation allowlist secret stays wired in either way, so
restoring invite-only is a parameter flip rather than a redeploy of configuration
that had been deleted. The backend refuses to start in production if
`ALPHA_INVITE_ONLY` is unset, or if it is false while the allowlist is empty.

Creating a CloudFormation change set performs validation and does not provision
resources. Executing it creates cost-bearing resources. Always inspect the
complete change-set actions and validation events before execution. Keep public
signup, Stripe, SES, monitoring, invitations beyond the explicit allowlist, and
application submission transports disabled until their separate acceptance
checks pass.
