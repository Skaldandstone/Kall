# Kall runtime image remediation

This record defines the source and deployment contract for the replacement
Kall development runtime. It does not approve an image or a cloud rollout.

## Source baseline and containment

The release-safety follow-up is based on
`f508a7fd3c0f8a6b279e092bf78e58ae87371537`.
The earlier runtime hardening was based on
`0f0dbb615260c1c42a25b5e8c0787f1896ffd72f`.
The contained AWS runtime used API source `e6b3844` and web source `7e0b7cf`.
The AWS owner reported both services scaled to zero and the database stopping
after discovering the flawed runtime. No AWS mutation was made from this lane.

The contained images were:

| Image | Resolved digest | Basic scan baseline |
| --- | --- | --- |
| API tag `1a9943715a5cf0b958468896d6d4adf307760c190e4711ba0ad1f0902f7c3416` | `sha256:1b0feac10c70f5b67e8e9e3935ddf3d0167d4b3535ea58d7cedf870f3fc0fd46` | 0 critical, 7 high, 1 medium, 2 undefined |
| Web tag `3cb6f791d24350fd0ed546c53a2c5514610b53aa3fcc9159267a878afab51004` | `sha256:c805ab021c3f21ca8e6e9ce938e04c882ef5efd5e7406daaa6394f21837ae779` | 0 critical, 7 high, 1 medium, 2 undefined |

Those findings remain open. A later controlled build from source `2084c0d`
also reported 0 critical, 7 high, 1 medium, and 2 undefined findings in each
image. The findings were attributed to Alpine OpenSSL `3.5.7-r0`; ECR did not
report a fixed version. No image from that build is approved for runtime use.

## Image contract

- API build context: repository root, Dockerfile `Dockerfile.api`.
- Web build context: `apps/web`, Dockerfile `apps/web/Dockerfile`.
- API base: `python:3.12.14-alpine3.24`, pinned to index digest
  `sha256:d81968c559557b881aa557ff6d1200acec8e72a2c85fcb4ad1806e8d13e09f0`.
  Its reviewed `linux/amd64` manifest is
  `sha256:78e98729f8fc4099e53cffb3fe59fd15b18dfa4ace8c914dee0cefa5320068eb`
  and its immutable package database contains `libssl3=3.5.8-r0` and
  `libcrypto3=3.5.8-r0`.
- Web base: `node:22.23.2-alpine3.24`, pinned to index digest
  `sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`.
  All web stages derive from this single reviewed base stage.
- API runtime identity: UID/GID `10001:10001`.
- Writable paths: `/tmp`, `/app/uploads`, and `/app/generated`. The task
  definition mounts ephemeral writable volumes at these paths and keeps the
  remaining root filesystem read-only.
- API health check: Python `urllib.request` against `127.0.0.1:8000/health`.
  Curl is not installed or required.
- Runtime command: `uvicorn kall.main:app --host 0.0.0.0 --port 8000
  --proxy-headers --forwarded-allow-ips *`.
- Migration command: `alembic upgrade head`, run once as the dedicated migration
  task before the service update. The expected Alembic head is
  `20260831_0029`.

### OpenSSL build gate

Both Dockerfiles fail before dependency installation when the base contains
`libssl3` or `libcrypto3` version `3.5.7-r0`. They also require an explicit
`ALPINE_OPENSSL_APPROVED_VERSION` build argument that exactly matches both
installed package versions. There is no default and the affected version is
rejected even if supplied explicitly.

The reviewed Python base has advanced to `3.5.8-r0`. The API Dockerfile now
accepts only that exact build argument and still validates both installed
packages against it. The Node base remains on `3.5.7-r0`, so the web Dockerfile
remains intentionally blocked. This clears only the API source input gate. It
does not approve an API output image, the web image, or a runtime launch.

Do not work around the gate with `apk upgrade`, a floating base tag, or an
unreviewed alternate image. When Alpine publishes a successor:

1. Review each official image manifest and update that image's pinned index
   digest.
2. Build with
   `--build-arg ALPINE_OPENSSL_APPROVED_VERSION=<reviewed-exact-version>`.
3. Confirm `libssl3` and `libcrypto3` resolve to that exact version in both
   images.
4. Record immutable output digests and rescan them in ECR.
5. Keep the launch gate closed until every critical, high, and undefined
   finding is reviewed.

The web digest still makes its current vulnerable input reproducible; it does
not remediate it. The package assertions prevent a future base refresh from
being silently accepted without review.

The runtime and migration task definitions accept separate Secrets Manager
ARNs containing `username` and `password`. Before deployment, the AWS owner must
create the PostgreSQL roles without exposing their values. The migrator role
needs schema migration permissions and advisory-lock access. The runtime role
needs only the application data privileges required after migration. The
runtime task must never receive the RDS master credentials.

### Database activation sequence

The stack defaults `EnableApplicationServices` to `false`, which creates the API
and web service resources at desired count zero. Application tasks cannot race
the database bootstrap or migration. Enabling services requires both
`VerifiedBootstrapRevision=kall-db-roles-v1` and
`VerifiedMigrationHead=20260831_0029`; CloudFormation rejects an activation
update without both values.

The source defines two one-shot task definitions:

1. `BootstrapTaskDefinition` receives the RDS managed-master username/password
   plus the separate migrator and runtime role secrets. It accepts only exact
   usernames `kalladmin`, `kall_migrator`, and `kall_runtime`, requires three
   distinct passwords of at least 32 characters, and connects with
   `verify-full` using the checked-in Region CA. It creates or rotates the two
   application roles, removes public schema creation, gives DDL only to the
   migrator, gives data access only to the runtime role, and installs runtime
   default privileges for objects the migrator creates. Existing public objects
   owned by another role stop the job for explicit review.
2. `MigrationTaskDefinition` receives only the migrator credential. It runs
   Alembic to `head`, opens a fresh connection, and exits nonzero unless the
   database heads exactly equal the source heads.

The bootstrap execution role alone can read the RDS managed-master, migrator,
and runtime role secrets. The migration execution role cannot read the master
or runtime secret. The API execution role cannot read the master or migrator
secret. Neither one-shot container receives an AWS task role. Both run as UID
`10001`, use a read-only root filesystem and a dedicated no-ingress database
admin security group, and write only to `/tmp`.

Deployment order is fail closed:

1. Create the initial stack with services disabled and externally generated
   migrator/runtime secret ARNs.
2. Run the bootstrap task once through `DatabaseAdminSecurityGroupId`; require
   exit code zero and the
   `database role bootstrap verified: kall-db-roles-v1` log line.
3. Run the migration task through the same security group; require exit code
   zero and `verified alembic heads: 20260831_0029`.
4. Review a second change set that supplies both evidence parameters and changes
   `EnableApplicationServices` to `true`.

Do not pass secret values in ECS command overrides, shell history, stack
parameters, or logs. A source assertion does not substitute for inspecting the
two stopped-task exit codes before the activation change set.

ECS execution permissions are split across web, API runtime, and migration
roles. The web execution role can read only the Clerk secret. The API execution
role can read only its application, alpha, provider, and runtime database
secrets. The migration execution role can read only the application, Clerk, and
migrator database secrets required to initialize `Settings` and run Alembic.

## Database TLS

The image contains the official Region-scoped RDS bundle at
`/etc/ssl/certs/aws-rds-us-east-2-bundle.pem`. Its reviewed SHA-256 is
`d46e1bdfda05c8e7644e50930806a19b139a222542bf0348082fb59ece2b5fa5`.
It contains the three Amazon RDS `us-east-2` G1 root certificates and no private
key material. Production PostgreSQL configuration now fails closed unless it
uses `sslmode=verify-full` and names a readable CA bundle.

The certificate source is
`https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem`.
Future bundle changes must be reviewed, committed, and followed by an API image
rebuild because the reviewed source snapshot now includes `deploy/certs/`.

## Routing and origin TLS

The web application owns `/api/kall/*`; its server proxy derives a Clerk token
and calls the API. The ALB listener sends only `/api/billing/webhook` directly
to FastAPI. This route remains dormant while sandbox billing is disabled and no
webhook registration is authorized.

The authoritative zone is Cloudflare, not Route 53. The template therefore
does not create a DNS record or accept a hosted-zone parameter. It accepts only
`origin.kall.skaldandstone.com` as `OriginDomainName` and requires an
`OriginCertificateArn` from project `734702670689` in `us-east-2`. The stack
outputs the ALB DNS name so the AWS owner can coordinate the external,
DNS-only Cloudflare CNAME after the load balancer exists. The existing
`kall.skaldandstone.com` record remains outside this template and unchanged.

CloudFront uses HTTPS-only to the external origin, and the web task uses the
same HTTPS origin for `KALL_API_URL`. The template contains no HTTP-only
CloudFront origin. This source change does not prove that external DNS, the
certificate chain, CloudFront, ALB, or the server-side proxy work in a deployed
environment. Verify all of them before registering a webhook.

## Secret and retention interface

The runtime stack accepts existing `AppSecretArn`, `SensitiveDataSecretArn`, and
`AlphaAccessSecretArn` parameters. It does not create fixed-name secrets or read
their values during source validation. The two CloudWatch log groups retain
logs for 30 days. The database keeps `DeletionPolicy: Snapshot` and
`UpdateReplacePolicy: Snapshot`.

Runtime expiry, cost enforcement, retained snapshots and secrets, and teardown
are owned entirely by the designated AWS task. This source change adds no
lifecycle controller and performs no AWS mutation.

Local `cfn-lint` 1.55.1 reports E3691 for RDS PostgreSQL `16.15` because its
packaged schema lags the service. The AWS owner verified read-only that exact
`16.15` is available for `db.t4g.micro` in `us-east-2`, uses `postgres16`, and
supports certificate rotation without restart. Validation may ignore only that
exact E3691 finding; no other template error is waived.

## Required AWS-owner validation

1. Build both images from the exact reviewed commit and record immutable image
   digests and source-manifest digest.
2. Scan both immutable images and review every high, critical, and undefined
   result. The old 7-high results per image are not waived.
3. Inspect the API image configuration for user `10001:10001`, Uvicorn-only
   command, fixed CA path, and absence of curl.
4. Run the migration task with the migrator secret, verify head
   `20260831_0029`, then run the service with the runtime secret.
5. Verify the read-only root filesystem and the three writable mounts under the
   actual Fargate CPU and memory limits.
6. Verify RDS hostname validation, CloudFront-to-origin TLS, web-to-origin TLS,
   `/api/kall/health` through the web proxy, and direct webhook routing with
   billing still disabled.
7. Keep monitoring, SES sending, Stripe billing, and live payments disabled.

Local tests and lint validate source structure and configuration behavior. They
do not validate Linux image execution, an image digest, package vulnerability
status, RDS connectivity, HTTPS, AWS capacity, or a deployed service.
