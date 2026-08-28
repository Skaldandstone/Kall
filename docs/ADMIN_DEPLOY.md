# Deploying the admin API

This covers rolling out the staff/CS admin surface added on
`claude/skaldandstone-domain-check-85chnv`: the `/api/admin/*` router
(`backend/kall/api_admin.py`), its `require_admin` gate, and the
`admin_api_token` config it reads. It sits on top of the existing infra
documented in `docs/AWS_DEPLOYMENT.md` — read that first for the account
model (`693272753663`, `us-east-2`, new-AWS-experience, ECS/Fargate, the
`agent-toolkit` SSO profile). Nothing here changes the architecture; it adds
one secret and rolls the `kall-api` service onto the new image.

## What ships

- `backend/kall/api_admin.py` — `/api/admin/*` (users search/detail,
  setActive, applications, pipeline inspector, data-subject export). Every
  route is behind `require_admin`, which compares the `X-Admin-Token` request
  header against `ADMIN_API_TOKEN` in constant time. No token set ⇒ the
  router refuses every request, so the surface is closed by default.
- `backend/kall/config.py` — adds `admin_api_token` (reads `ADMIN_API_TOKEN`).
- `backend/kall/router_registry.py` — registers `admin_router`.
- The data-subject export **never decrypts** stored EEO / work-authorization
  fields; it emits an individually-audited reveal marker instead. That
  property is covered by `tests/test_admin_api.py` — keep it green.

No database migration is involved — this is read-mostly plus a reversible
`setActive` toggle on an existing column.

## One new secret

`require_admin` reads `ADMIN_API_TOKEN` at runtime, so it belongs in Secrets
Manager alongside the other `kall/*` secrets, not as a plaintext env var.

```bash
# Generate a strong token and store it.
TOKEN=$(openssl rand -hex 32)
aws secretsmanager create-secret \
  --name kall/admin-api-token \
  --secret-string "$TOKEN" \
  --profile agent-toolkit --region us-east-2

# Put the SAME value into the portal Worker so its Kall proxy can authenticate:
#   grok-adminhelper secret  KALL_ADMIN_TOKEN = $TOKEN
# (see ginnungagap/infra/adminhelper/DEPLOY.md)
```

The `kall-ecs-execution-role` already has a `kall/*` wildcard read, so it can
read this new secret with no IAM change. Add it to the `kall-api` task
definition's `secrets` block as a new revision:

```json
{ "name": "ADMIN_API_TOKEN",
  "valueFrom": "arn:aws:secretsmanager:us-east-2:693272753663:secret:kall/admin-api-token" }
```

Register the new task-definition revision, then point the service at it.

## Roll it out

```bash
# 1. Build the new API image from the branch HEAD.
#    kall-api-build builds from GitHub; make sure it builds the branch that
#    carries api_admin.py (merge to main, or repoint the build's source ref).
aws codebuild start-build --project-name kall-api-build \
  --profile agent-toolkit --region us-east-2

# 2. Once the image is pushed, roll the service onto the new task-def revision
#    (the one that adds the ADMIN_API_TOKEN secret). Substitute the revision #.
aws ecs update-service --cluster kall-cluster --service kall-api \
  --task-definition kall-api:<new-rev> \
  --profile agent-toolkit --region us-east-2
```

The container runs `alembic upgrade head` on start; there is no admin
migration, so this is a no-op for this change but keeps the usual invariant
(image contains any migration before the service moves to it).

## Verify

```bash
BASE=https://d7wb2yokfqcku.cloudfront.net   # the public CloudFront URL

# No/blank token ⇒ 401.
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/admin/users?q=test"

# With the token ⇒ 200 and a JSON body.
curl -s -H "X-Admin-Token: $TOKEN" "$BASE/api/admin/users?q=@" | head -c 400
```

Then confirm the same call works through the portal (the Kall tab at
grok.skaldandstone.com/adminhelper) — a user search proves the
Worker→`KALL_ADMIN_TOKEN`→API path end to end. Every write the portal issues
is audited to the D1 log on the Worker side.

## Notes

- **No CI trigger** — same as the rest of this account; the CodeBuild →
  `update-service` sequence above is manual and needs an active
  `agent-toolkit` SSO session (`aws login --region us-east-2 --profile
  agent-toolkit` if expired).
- **Rotating the token** is: put a new value in `kall/admin-api-token`, force
  a new deployment (`--force-new-deployment`) so tasks pick it up, then update
  `KALL_ADMIN_TOKEN` on the Worker. Do the Worker second so there's no window
  where the portal holds a token the API has already stopped accepting.
