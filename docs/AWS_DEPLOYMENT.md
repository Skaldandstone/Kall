# AWS deployment

Kall's backend and web app run on AWS (account `693272753663`, region `us-east-2`), replacing an earlier Render setup, which has now been removed entirely. `docs/PRODUCTION_DEPLOYMENT.md` covers the host-independent layer on top: application configuration and the Stripe test-to-live cutover. This document records what was actually built, why it's shaped the way it is, and how to operate it - so a future session doesn't have to rediscover it by hitting access-denied errors the way this one did.

## Account context

This is an AWS **"new AWS experience"** account: AWS manages IAM/SCPs/RCPs on your behalf (see `CLAUDE.md` for the full agent rules AWS publishes for this experience), the account is on the **FREE tier** with a **$100 credit** (expires 2027-02-22), and it's locked to a **single assigned region** (`us-east-2`) - regional resources cannot be created anywhere else.

**AWS App Runner is not usable in this account** - it's blocked by a Service Control Policy account-wide, independent of IAM permissions, most likely because it isn't on this tier's supported-services list. That's why this deploys to ECS/Fargate instead, which is the compute model to reach for by default here rather than re-litigating App Runner.

Two identities exist for this account:
- `KallBot` IAM user (access key, `aws configure`, the default profile) - was blocked from EC2/RDS/ECS/Lambda/Secrets Manager/DynamoDB by an SCP when this document was first written, but that block has since been lifted or narrowed: on 2026-08-28 KallBot successfully read ECS/CodeBuild and performed IAM role/policy writes, S3 bucket creation, and EventBridge Scheduler writes. Useful because it never expires.
- `agent-toolkit` profile (`aws login`, assumes `AccountFullAccessRole` via SSO, credentials last 12h/renewable 90 days) - re-run `aws login --region us-east-2 --profile agent-toolkit` when it expires. One SCP denial observed against even this role: IAM OIDC-provider operations (which is why the CI deploy job uses an access key, not GitHub OIDC federation).

## Why this architecture, specifically

- **No NAT Gateway.** The textbook setup puts RDS in private subnets reached only through a NAT Gateway, but a NAT Gateway alone costs more per month than is reasonable against a one-time $100 credit. Instead, ECS Fargate tasks run in the default VPC's public subnets (so they reach the internet directly for ECR pulls and outbound calls), and **security groups**, not subnet placement, keep RDS and the API from being reachable - RDS is flagged not-publicly-accessible and its security group only accepts the API tasks' security group.
- **The web app never calls the API directly** - it proxies every call server-side through its own `/api/kall/[...path]` route (`apps/web/app/api/kall/[...path]/route.ts`), reaching `kall-api` internally via **ECS Service Connect** (Cloud Map namespace `kall.local`). This was originally the *only* path to the API (no public ingress at all), for the smallest possible attack surface on a service holding EEO/work-authorization data.
- **The API also has a public path now, at `/api/*` on the same CloudFront/ALB** (added for the native mobile app in `apps/mobile`, which has no server-side proxy of its own and must call the API directly). This reuses the existing ALB and CloudFront distribution rather than standing up a second one - see "Public API path" below for exactly what was added and why it required recreating the `kall-api` ECS service.
- **CloudFront in front of the ALB, not a custom domain.** No domain was available for this deployment. CloudFront hands out a free `*.cloudfront.net` subdomain with a real, publicly-trusted TLS certificate automatically, which is what makes the web app's public endpoint actually HTTPS without buying anything. CloudFront → ALB traffic is plain HTTP (`OriginProtocolPolicy: http-only`) since there's no cert to put on the ALB itself - this is the one hop in the whole path that isn't encrypted, and the thing to fix first if a domain is ever added (attach an ACM cert to the ALB, flip the origin policy to `https-only`).
- **DB_HOST/DB_USER/DB_PASSWORD instead of one DATABASE_URL.** RDS's master password is managed natively by RDS itself (`--manage-master-user-password`) and lives in a Secrets Manager secret RDS created and rotates on its own - nothing ever composed a connection string containing it. The API task definition references that secret's `password` key directly via ECS's `secrets` block, and `backend/kall/config.py`'s `build_database_url_from_parts()` assembles the real `DATABASE_URL` inside the running container from `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` (plain env vars) plus `DB_PASSWORD` (injected secret).

## What exists

| Resource | Identifier |
|---|---|
| ECS cluster | `kall-cluster` |
| ECS services | `kall-api` (Service Connect *and* a public ALB path at `/api/*`, see below), `kall-web` (behind the ALB) |
| Task definitions | `kall-api`, `kall-web` (Fargate, 256 CPU / 512 MB each) |
| ECR repos | `693272753663.dkr.ecr.us-east-2.amazonaws.com/kall-api`, `.../kall-web` (KMS-encrypted, scan-on-push) |
| RDS instance | `kall-postgres` - `db.t4g.micro`, Postgres 16.15, single-AZ, 20GB gp3, storage-encrypted, not publicly accessible, `rds.force_ssl=1` via parameter group `kall-postgres16-forcessl`, 1-day backup retention (free-tier ceiling) |
| Service Connect namespace | `kall.local` (Cloud Map HTTP namespace) - API is reachable internally at `kall-api.kall.local:8000` |
| ALB | `kall-alb`, HTTP listener on 80. Default action → `kall-web-tg` (port 3000). Rule (priority 1, path `/api/*`) → `kall-api-tg` (port 8000, target type `ip`) |
| CloudFront | `E2ZZ5V24QLF8BA` → `https://d7wb2yokfqcku.cloudfront.net` (the public URL) |
| Secrets Manager | `kall/app-secret-key`, `kall/sensitive-data-encryption-key`, `kall/clerk-secret-key`, `kall/clerk-publishable-key`, plus the RDS-managed `rds!db-...` secret. Three `kall/*-oauth-client-secret` entries survive from the pre-Clerk auth system and are unreferenced - see below. |
| S3 bucket | `kall-documents-693272753663` - resumes and generated documents (uploads/, generated/, data/generated-resumes/), private (public access blocked), SSE-S3 encrypted, versioned |
| IAM roles | `kall-ecs-execution-role` (ECR pull, CloudWatch Logs, reads `kall/*` and `rds!db-*` secrets), `kall-api-task-role` (the `kall-api` container's own AWS calls - scoped to `s3:GetObject`/`PutObject`/`DeleteObject`/`ListBucket` on `kall-documents-693272753663` only), `kall-codebuild-role` (ECR push, CloudWatch Logs) |
| CodeBuild projects | `kall-api-build` (`Dockerfile.api`, repo root context), `kall-web-build` (`apps/web/Dockerfile`, `apps/web` context) - buildspecs live in `ops/codebuild/`, source arrives as an S3 zip from the CI deploy job (the repo is private; CodeBuild holds no GitHub credential) |
| Build sources bucket | `kall-build-sources-693272753663` - private, 30-day lifecycle expiry, written by the CI deploy job, read by `kall-codebuild-role` |
| EventBridge Scheduler | `kall-hourly-jobs` (rate 1 hour → `python -m kall.jobs.hourly`: billing grace period, daily-brief queue, scheduled discovery, notification outbox drain) and `kall-daily-jobs` (06:30 UTC → `python -m kall.jobs.daily`: artifact retention, certification + growth-milestone reminders). Both RunTask the current `kall-api` task definition on `kall-cluster` with a container command override, via `kall-scheduler-role` (`ecs:RunTask` + `iam:PassRole` for the two task roles, nothing else) |
| Security groups | `kall-alb-sg` (80 from internet) → `kall-web-tasks-sg` (3000 from ALB) and `kall-api-tasks-sg` (8000 from web tasks *and* from `kall-alb-sg` directly) → `kall-rds-sg` (5432 from API tasks) |

Local Docker isn't installed on the machine this was built from (Docker Desktop's installer failed - WSL2 isn't enabled and needs a restart to set up), which is why CodeBuild builds images directly from GitHub instead of a local `docker build && docker push`.

## Redeploying after a code change

**Deploys are automatic on merge to main.** The `deploy` job in `.github/workflows/ci.yml` runs on every push to main, strictly after all five test jobs pass, decides which image the pushed range actually touched (backend paths → `kall-api-build`, `apps/web/` → `kall-web-build`), uploads the gated commit's tree as a zip to `s3://kall-build-sources-693272753663/github-deploy/` (30-day expiry), and starts the matching CodeBuild build with an S3 source override pointing at that archive. The S3 hop exists because the repository is private and CodeBuild deliberately holds no GitHub credential - its GITHUB source type cannot clone at all ("authentication required" in DOWNLOAD_SOURCE) - and it has the nice side effect of pinning the deploy to the exact commit the tests passed on. The projects' configured GITHUB source only matters for manually started builds, which therefore no longer work without importing a GitHub credential into CodeBuild; use workflow_dispatch instead. Each build now deploys itself: the buildspecs live in `ops/codebuild/*.buildspec.yml` (no longer inline in the project config) and end with `ecs update-service --force-new-deployment` plus a `services-stable` wait, so a green build means the rollout completed and passed health checks, and a task that never comes healthy fails the build visibly after ~10 minutes.

Pieces involved:

- **IAM user `kall-github-deploy`** - its access key lives in the repo's Actions secrets (`KALL_DEPLOY_AWS_ACCESS_KEY_ID` / `KALL_DEPLOY_AWS_SECRET_ACCESS_KEY`). Deliberately scoped to `codebuild:StartBuild`/`BatchGetBuilds` on the two projects and nothing else - a leaked key can redeploy main's HEAD, not read data or change infrastructure. GitHub OIDC federation would have avoided a stored key entirely, but this account's managed SCP explicitly denies IAM OIDC-provider operations, so a scoped key is the available shape.
- **`kall-codebuild-role`** gained inline policy `kall-codebuild-ecs-deploy`: `ecs:UpdateService`/`DescribeServices` on the two services only.
- **Manual deploys** (config-only changes, rolling back to main's HEAD): run the CI workflow by hand from the Actions tab (workflow_dispatch) with the `deploy_api`/`deploy_web` inputs - tests still gate it, and the workflow is the only path that can hand CodeBuild the source now that the repo is private. `aws codebuild start-build` on its own no longer works (DOWNLOAD_SOURCE fails - no GitHub credential in AWS); a config-only ECS bounce without a rebuild is still just `aws ecs update-service --force-new-deployment`.
- **Rolling back a bad deploy**: every CI-built image is also tagged with its commit SHA (the buildspecs derive it from the source zip's name), so the previous image survives a bad push of `:latest`. To roll back without building anything, point `:latest` back at the old image and bounce the service:

```bash
MANIFEST=$(aws ecr batch-get-image --repository-name kall-api --image-ids imageTag=<good-sha> --query 'images[0].imageManifest' --output text --region us-east-2)
aws ecr put-image --repository-name kall-api --image-tag latest --image-manifest "$MANIFEST" --region us-east-2
aws ecs update-service --cluster kall-cluster --service kall-api --force-new-deployment --region us-east-2
```

  The next merge to main will overwrite `:latest` again, so a rollback is a stopgap while the bad commit is reverted in git, not a resting state.

## Known gaps / next steps

- **No custom domain / ACM cert on the ALB.** CloudFront's default domain covers the "properly encrypted" requirement for now; revisit if a real domain shows up.
- **Backup retention is 1 day** (free-tier ceiling) and this is **single-AZ** - both are reasonable for a $100-credit bootstrap phase, not for a real production SLA. Revisit if/when the account moves off the free tier.
- **Social sign-in providers are configured in Clerk, not here.** Enabling Google/GitHub/etc. is a Clerk dashboard change; no AWS secret or task-definition edit is involved, which is one of the reasons identity moved to Clerk.

## Identity (Clerk)

Authentication is Clerk's, not Kall's - see `backend/kall/auth.py`. Two consequences for deployment:

- **Both services need Clerk credentials or every request 401s.** `kall-api` verifies Clerk session tokens and needs `CLERK_SECRET_KEY`; `kall-web` needs `CLERK_SECRET_KEY` (its `/api/kall/[...path]` proxy mints the backend token server-side) and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Store both as `kall/*` Secrets Manager secrets and reference them from the task definitions' `secrets` blocks, exactly like `kall/app-secret-key`. **Add these before rolling out the Clerk revision** - a task that starts without `CLERK_SECRET_KEY` returns 503 on every authenticated route.
- **The publishable key is baked into the web image at build time, and needs a build arg.** `NEXT_PUBLIC_*` values are inlined by `next build`, which runs *inside* the Docker build - so a CodeBuild environment variable does not reach it on its own. `apps/web/Dockerfile` declares `ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and the build has to pass it through:

  ```
  docker build --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" -t kall-web apps/web
  ```

  Setting it only on the task definition builds an image with no key in it, and every page then fails with "Missing publishableKey". A publishable key is public by design, so a build arg is fine here - but `CLERK_SECRET_KEY` must never be passed that way, because build args are recorded in the image history. It is a runtime secret on both services.

The mobile app reads `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` at build time via `apps/mobile/app.config.js`.

### What is already configured

Done, and verified against the live account:

| Change | Detail |
| --- | --- |
| Secrets created | `kall/clerk-secret-key`, `kall/clerk-publishable-key` |
| `kall-api` revision 4 | Adds `CLERK_SECRET_KEY`; drops the dead `GOOGLE_/GITHUB_/LINKEDIN_OAUTH_CLIENT_ID` + `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` env vars and the three OAuth client-secret references |
| `kall-web` revision 2 | Adds `CLERK_SECRET_KEY` (the proxy needs it at runtime) |
| `kall-web-build` buildspec | Reads the publishable key from Secrets Manager and passes it as `--build-arg` |
| `kall-codebuild-role` | New inline policy `kall-codebuild-clerk-publishable-read`, scoped to the publishable key alone - the build has no business reading the secret key or the database password |

The execution role needed no change: its existing `kall/*` wildcard already covers both new secrets.

**Nothing is deployed.** The services still run `kall-api:3` and `kall-web:1`, which are the pre-Clerk images. Rolling out is a deliberate two-step:

```bash
aws codebuild start-build --project-name kall-api-build --region us-east-2
aws codebuild start-build --project-name kall-web-build --region us-east-2
# once both images are pushed
aws ecs update-service --cluster kall-cluster --service kall-api --task-definition kall-api:4 --region us-east-2
aws ecs update-service --cluster kall-cluster --service kall-web --task-definition kall-web:2 --region us-east-2
```

Order matters. Revision 4 on the old image would run pre-Clerk code against a task definition it does not understand, and the API container runs `alembic upgrade head` on start - so the image must contain the Clerk migration before the service moves to it.

### Two things still outstanding

- **These are development Clerk keys.** No production Clerk instance exists yet. A `pk_test_`/`sk_test_` pair works, but the instance carries a 100-user cap and dev-instance semantics. Creating a production instance and rotating both secrets is a prerequisite for real users.
- **Three dead OAuth secrets remain** in Secrets Manager: `kall/google-oauth-client-secret`, `kall/github-oauth-client-secret`, `kall/linkedin-oauth-client-secret`. Nothing references them any more. They hold live credentials, so revoke them at Google/GitHub/LinkedIn first, then delete the secrets.

## Public API path (for the native mobile app)

`apps/mobile` (React Native/Expo) has no server-side hop like the web app's `/api/kall/[...path]` proxy - it calls the API directly over the internet, so `kall-api` needed a real public path. Rather than a second ALB or a second CloudFront distribution, this reuses the existing ones:

- New target group `kall-api-tg` (target type `ip`, port 8000, health check `/health`).
- New rule on `kall-alb`'s existing HTTP listener: path pattern `/api/*` → `kall-api-tg` (priority 1, ahead of the default `kall-web-tg` action - every other path still goes to the web app, unchanged).
- New security-group rule: `kall-alb-sg` → `kall-api-tasks-sg` on port 8000 (previously only `kall-web-tasks-sg` could reach it).
- **No CloudFront change needed.** The distribution's one existing cache behavior already forwards every path/method/header (`CachingDisabled` + `AllViewer` origin request policy - including `Authorization`) to `kall-alb-origin`. Since `kall-alb` itself now does the path-based split, `/api/*` requests reach `kall-api` without CloudFront needing a second behavior or origin.
- **This required deleting and recreating the `kall-api` ECS service** (brief downtime) - ECS's `UpdateService` API cannot attach a load balancer/target group to an existing service after creation; only `CreateService` accepts `loadBalancers`. The Service Connect config, network config, and task definition were preserved exactly; only `loadBalancers` and `healthCheckGracePeriodSeconds: 30` were added.
- CORS was **not** touched - CORS is a browser-only mechanism and doesn't apply to native app HTTP clients. The rate limiter (`backend/kall/rate_limit.py`) continues to see real client IPs through the ALB/CloudFront chain via the existing `--proxy-headers --forwarded-allow-ips='*'` uvicorn flags.

Verify: `curl https://d7wb2yokfqcku.cloudfront.net/api/health` from any machine (no browser needed) should return `{"status":"ok","product":"Kall"}`.

## Document storage

Uploaded resumes and generated documents (resume/cover-letter artifacts) go through `backend/kall/services/storage.py`, which picks a backend based on config: `AWS_S3_BUCKET` set → S3 (`kall-documents-693272753663`, via `kall-api-task-role`); unset → local filesystem (what local dev and CI use). `ResumeDocument.file_path` / `DocumentArtifact.file_path` are storage *keys* (e.g. `uploads/1/resume.pdf`), not filesystem paths - they mean whatever the active backend resolves them to. `kall-api` task definition revision 2+ carries `AWS_S3_BUCKET`/`AWS_REGION` and the `taskRoleArn`; older running tasks fall back to local disk until redeployed onto that revision.
