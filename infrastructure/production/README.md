# Kall production infrastructure

`../kall-production.yaml` is a separate durable production stack. It does not
modify or revive the expiring alpha runtime. Regional resources stay in the
selected Region `us-east-2` and AWS project `734702670689`; Cloudflare continues
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
records `kall-db-roles-v1` and `20260831_0029`. Only a second reviewed change
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
aws cloudformation validate-template --profile skaldandstone-dev --region us-east-2 --template-body file://infrastructure/kall-production.yaml
python -m pytest -q tests/test_production_infrastructure.py infrastructure/production/test_cost_model.py
python .\infrastructure\production\cost_model.py
```

`E3691` remains limited to local `cfn-lint` 1.55.1 lagging the AWS-supported
PostgreSQL 16.15 engine value. Do not ignore another finding.

The deterministic low-traffic model is **$73.71 per 730-hour month** before
credits and taxes. It assumes two continuously running 0.25 vCPU/0.5 GB tasks,
Multi-AZ `db.t4g.micro`, 20 GiB gp3, one ALB and one average LCU, six secrets,
six alarms, 1 GiB logs, 5 GiB documents, 10 GiB CloudFront data out, and one
million HTTPS requests. It excludes the shared foundation, request charges,
snapshot growth, provider fees, email, AI, monitoring, WAF, and traffic above
those assumptions. The existing AWS project budget is $100/month, so review
project-wide usage and credits in AWS Settings > Billing before executing the
production change set.

Creating a CloudFormation change set performs validation and does not provision
resources. Executing it creates cost-bearing resources. Always inspect the
complete change-set actions and validation events before execution. Keep public
signup, Stripe, SES, monitoring, invitations beyond the explicit allowlist, and
application submission transports disabled until their separate acceptance
checks pass.
