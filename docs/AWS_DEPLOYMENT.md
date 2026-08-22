# AWS deployment

Kall's backend and web app run on AWS (account `693272753663`, region `us-east-2`), replacing the earlier Render setup described in `docs/PRODUCTION_DEPLOYMENT.md`. This document records what was actually built, why it's shaped the way it is, and how to operate it — so a future session doesn't have to rediscover it by hitting access-denied errors the way this one did.

## Account context

This is an AWS **"new AWS experience"** account: AWS manages IAM/SCPs/RCPs on your behalf (see `CLAUDE.md` for the full agent rules AWS publishes for this experience), the account is on the **FREE tier** with a **$100 credit** (expires 2027-02-22), and it's locked to a **single assigned region** (`us-east-2`) — regional resources cannot be created anywhere else.

**AWS App Runner is not usable in this account** — it's blocked by a Service Control Policy account-wide, independent of IAM permissions, most likely because it isn't on this tier's supported-services list. That's why this deploys to ECS/Fargate instead, which is the compute model to reach for by default here rather than re-litigating App Runner.

Two identities exist for this account:
- `KallBot` IAM user (access key, `aws configure`) — was blocked from EC2/RDS/ECS/Lambda/Secrets Manager/DynamoDB by an SCP.
- `agent-toolkit` profile (`aws login`, assumes `AccountFullAccessRole` via SSO, credentials last 12h/renewable 90 days) — **not** subject to that same block. Use this profile for AWS work on this project. Re-run `aws login --region us-east-2 --profile agent-toolkit` when it expires.

## Why this architecture, specifically

- **No NAT Gateway.** The textbook setup puts RDS in private subnets reached only through a NAT Gateway, but a NAT Gateway alone costs more per month than is reasonable against a one-time $100 credit. Instead, ECS Fargate tasks run in the default VPC's public subnets (so they reach the internet directly for ECR pulls and outbound calls), and **security groups**, not subnet placement, keep RDS and the API from being reachable — RDS is flagged not-publicly-accessible and its security group only accepts the API tasks' security group.
- **The API is not internet-facing at all.** The Next.js web app already proxies every API call server-side through its own `/api/kall/[...path]` route (`apps/web/app/api/kall/[...path]/route.ts`) — browsers never call the API directly. So the API only needs to be reachable from the web app's own containers, via **ECS Service Connect** (Cloud Map namespace `kall.local`), never through a public load balancer. This is both cheaper (one ALB instead of two) and more secure (smallest possible attack surface for the service holding EEO/work-authorization data).
- **CloudFront in front of the ALB, not a custom domain.** No domain was available for this deployment. CloudFront hands out a free `*.cloudfront.net` subdomain with a real, publicly-trusted TLS certificate automatically, which is what makes the web app's public endpoint actually HTTPS without buying anything. CloudFront → ALB traffic is plain HTTP (`OriginProtocolPolicy: http-only`) since there's no cert to put on the ALB itself — this is the one hop in the whole path that isn't encrypted, and the thing to fix first if a domain is ever added (attach an ACM cert to the ALB, flip the origin policy to `https-only`).
- **DB_HOST/DB_USER/DB_PASSWORD instead of one DATABASE_URL.** RDS's master password is managed natively by RDS itself (`--manage-master-user-password`) and lives in a Secrets Manager secret RDS created and rotates on its own — nothing ever composed a connection string containing it. The API task definition references that secret's `password` key directly via ECS's `secrets` block, and `backend/kall/config.py`'s `build_database_url_from_parts()` assembles the real `DATABASE_URL` inside the running container from `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` (plain env vars) plus `DB_PASSWORD` (injected secret).

## What exists

| Resource | Identifier |
|---|---|
| ECS cluster | `kall-cluster` |
| ECS services | `kall-api` (Service Connect only, no public ingress), `kall-web` (behind the ALB) |
| Task definitions | `kall-api`, `kall-web` (Fargate, 256 CPU / 512 MB each) |
| ECR repos | `693272753663.dkr.ecr.us-east-2.amazonaws.com/kall-api`, `.../kall-web` (KMS-encrypted, scan-on-push) |
| RDS instance | `kall-postgres` — `db.t4g.micro`, Postgres 16.15, single-AZ, 20GB gp3, storage-encrypted, not publicly accessible, `rds.force_ssl=1` via parameter group `kall-postgres16-forcessl`, 1-day backup retention (free-tier ceiling) |
| Service Connect namespace | `kall.local` (Cloud Map HTTP namespace) — API is reachable internally at `kall-api.kall.local:8000` |
| ALB | `kall-alb` → target group `kall-web-tg` (port 3000), HTTP listener on 80 |
| CloudFront | `E2ZZ5V24QLF8BA` → `https://d7wb2yokfqcku.cloudfront.net` (the public URL) |
| Secrets Manager | `kall/app-secret-key`, `kall/sensitive-data-encryption-key`, plus the RDS-managed `rds!db-...` secret |
| IAM roles | `kall-ecs-execution-role` (ECR pull, CloudWatch Logs, reads `kall/*` and `rds!db-*` secrets), `kall-codebuild-role` (ECR push, CloudWatch Logs) |
| CodeBuild projects | `kall-api-build` (`Dockerfile.api`, repo root context), `kall-web-build` (`apps/web/Dockerfile`, `apps/web` context) — both build from GitHub directly, no local Docker involved |
| Security groups | `kall-alb-sg` (80 from internet) → `kall-web-tasks-sg` (3000 from ALB) → `kall-api-tasks-sg` (8000 from web tasks) → `kall-rds-sg` (5432 from API tasks) |

Local Docker isn't installed on the machine this was built from (Docker Desktop's installer failed — WSL2 isn't enabled and needs a restart to set up), which is why CodeBuild builds images directly from GitHub instead of a local `docker build && docker push`.

## Redeploying after a code change

There's no CI trigger wired up yet — deploys are manual:

```bash
# Rebuild whichever image changed
aws codebuild start-build --project-name kall-api-build --profile agent-toolkit --region us-east-2
aws codebuild start-build --project-name kall-web-build --profile agent-toolkit --region us-east-2

# Both build from main's HEAD.

# Force ECS to pull the new :latest image
aws ecs update-service --cluster kall-cluster --service kall-api --force-new-deployment --profile agent-toolkit --region us-east-2
aws ecs update-service --cluster kall-cluster --service kall-web --force-new-deployment --profile agent-toolkit --region us-east-2
```

## Known gaps / next steps

- **No custom domain / ACM cert on the ALB.** CloudFront's default domain covers the "properly encrypted" requirement for now; revisit if a real domain shows up.
- **No CI/CD trigger** — CodeBuild has to be started manually per the commands above. A GitHub webhook or CodePipeline would close this gap.
- **Backup retention is 1 day** (free-tier ceiling) and this is **single-AZ** — both are reasonable for a $100-credit bootstrap phase, not for a real production SLA. Revisit if/when the account moves off the free tier.
- **OAuth provider secrets aren't in Secrets Manager yet** — none were configured for this environment; add `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` etc. as additional `kall/*` secrets and task-definition `secrets` entries when SSO is actually turned on here.
