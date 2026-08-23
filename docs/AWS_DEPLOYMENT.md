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
- **The web app never calls the API directly** — it proxies every call server-side through its own `/api/kall/[...path]` route (`apps/web/app/api/kall/[...path]/route.ts`), reaching `kall-api` internally via **ECS Service Connect** (Cloud Map namespace `kall.local`). This was originally the *only* path to the API (no public ingress at all), for the smallest possible attack surface on a service holding EEO/work-authorization data.
- **The API also has a public path now, at `/api/*` on the same CloudFront/ALB** (added for the native mobile app in `apps/mobile`, which has no server-side proxy of its own and must call the API directly). This reuses the existing ALB and CloudFront distribution rather than standing up a second one — see "Public API path" below for exactly what was added and why it required recreating the `kall-api` ECS service.
- **CloudFront in front of the ALB, not a custom domain.** No domain was available for this deployment. CloudFront hands out a free `*.cloudfront.net` subdomain with a real, publicly-trusted TLS certificate automatically, which is what makes the web app's public endpoint actually HTTPS without buying anything. CloudFront → ALB traffic is plain HTTP (`OriginProtocolPolicy: http-only`) since there's no cert to put on the ALB itself — this is the one hop in the whole path that isn't encrypted, and the thing to fix first if a domain is ever added (attach an ACM cert to the ALB, flip the origin policy to `https-only`).
- **DB_HOST/DB_USER/DB_PASSWORD instead of one DATABASE_URL.** RDS's master password is managed natively by RDS itself (`--manage-master-user-password`) and lives in a Secrets Manager secret RDS created and rotates on its own — nothing ever composed a connection string containing it. The API task definition references that secret's `password` key directly via ECS's `secrets` block, and `backend/kall/config.py`'s `build_database_url_from_parts()` assembles the real `DATABASE_URL` inside the running container from `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` (plain env vars) plus `DB_PASSWORD` (injected secret).

## What exists

| Resource | Identifier |
|---|---|
| ECS cluster | `kall-cluster` |
| ECS services | `kall-api` (Service Connect *and* a public ALB path at `/api/*`, see below), `kall-web` (behind the ALB) |
| Task definitions | `kall-api`, `kall-web` (Fargate, 256 CPU / 512 MB each) |
| ECR repos | `693272753663.dkr.ecr.us-east-2.amazonaws.com/kall-api`, `.../kall-web` (KMS-encrypted, scan-on-push) |
| RDS instance | `kall-postgres` — `db.t4g.micro`, Postgres 16.15, single-AZ, 20GB gp3, storage-encrypted, not publicly accessible, `rds.force_ssl=1` via parameter group `kall-postgres16-forcessl`, 1-day backup retention (free-tier ceiling) |
| Service Connect namespace | `kall.local` (Cloud Map HTTP namespace) — API is reachable internally at `kall-api.kall.local:8000` |
| ALB | `kall-alb`, HTTP listener on 80. Default action → `kall-web-tg` (port 3000). Rule (priority 1, path `/api/*`) → `kall-api-tg` (port 8000, target type `ip`) |
| CloudFront | `E2ZZ5V24QLF8BA` → `https://d7wb2yokfqcku.cloudfront.net` (the public URL) |
| Secrets Manager | `kall/app-secret-key`, `kall/sensitive-data-encryption-key`, plus the RDS-managed `rds!db-...` secret |
| S3 bucket | `kall-documents-693272753663` — resumes and generated documents (uploads/, generated/, data/generated-resumes/), private (public access blocked), SSE-S3 encrypted, versioned |
| IAM roles | `kall-ecs-execution-role` (ECR pull, CloudWatch Logs, reads `kall/*` and `rds!db-*` secrets), `kall-api-task-role` (the `kall-api` container's own AWS calls — scoped to `s3:GetObject`/`PutObject`/`DeleteObject`/`ListBucket` on `kall-documents-693272753663` only), `kall-codebuild-role` (ECR push, CloudWatch Logs) |
| CodeBuild projects | `kall-api-build` (`Dockerfile.api`, repo root context), `kall-web-build` (`apps/web/Dockerfile`, `apps/web` context) — both build from GitHub directly, no local Docker involved |
| Security groups | `kall-alb-sg` (80 from internet) → `kall-web-tasks-sg` (3000 from ALB) and `kall-api-tasks-sg` (8000 from web tasks *and* from `kall-alb-sg` directly) → `kall-rds-sg` (5432 from API tasks) |

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

## Public API path (for the native mobile app)

`apps/mobile` (React Native/Expo) has no server-side hop like the web app's `/api/kall/[...path]` proxy — it calls the API directly over the internet, so `kall-api` needed a real public path. Rather than a second ALB or a second CloudFront distribution, this reuses the existing ones:

- New target group `kall-api-tg` (target type `ip`, port 8000, health check `/health`).
- New rule on `kall-alb`'s existing HTTP listener: path pattern `/api/*` → `kall-api-tg` (priority 1, ahead of the default `kall-web-tg` action — every other path still goes to the web app, unchanged).
- New security-group rule: `kall-alb-sg` → `kall-api-tasks-sg` on port 8000 (previously only `kall-web-tasks-sg` could reach it).
- **No CloudFront change needed.** The distribution's one existing cache behavior already forwards every path/method/header (`CachingDisabled` + `AllViewer` origin request policy — including `Authorization`) to `kall-alb-origin`. Since `kall-alb` itself now does the path-based split, `/api/*` requests reach `kall-api` without CloudFront needing a second behavior or origin.
- **This required deleting and recreating the `kall-api` ECS service** (brief downtime) — ECS's `UpdateService` API cannot attach a load balancer/target group to an existing service after creation; only `CreateService` accepts `loadBalancers`. The Service Connect config, network config, and task definition were preserved exactly; only `loadBalancers` and `healthCheckGracePeriodSeconds: 30` were added.
- CORS was **not** touched — CORS is a browser-only mechanism and doesn't apply to native app HTTP clients. The rate limiter (`backend/kall/rate_limit.py`) continues to see real client IPs through the ALB/CloudFront chain via the existing `--proxy-headers --forwarded-allow-ips='*'` uvicorn flags.

Verify: `curl https://d7wb2yokfqcku.cloudfront.net/api/health` from any machine (no browser needed) should return `{"status":"ok","product":"Kall"}`.

## Document storage

Uploaded resumes and generated documents (resume/cover-letter artifacts) go through `backend/kall/services/storage.py`, which picks a backend based on config: `AWS_S3_BUCKET` set → S3 (`kall-documents-693272753663`, via `kall-api-task-role`); unset → local filesystem (what local dev and CI use). `ResumeDocument.file_path` / `DocumentArtifact.file_path` are storage *keys* (e.g. `uploads/1/resume.pdf`), not filesystem paths — they mean whatever the active backend resolves them to. `kall-api` task definition revision 2+ carries `AWS_S3_BUCKET`/`AWS_REGION` and the `taskRoleArn`; older running tasks fall back to local disk until redeployed onto that revision.
