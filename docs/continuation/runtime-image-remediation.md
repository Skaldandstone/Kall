# Kall runtime image remediation

This record defines the source and deployment contract for the replacement
Kall development runtime. It does not approve an image or a cloud rollout.

## Source baseline and containment

The final remediation commit is based on `0f0dbb615260c1c42a25b5e8c0787f1896ffd72f`.
The contained AWS runtime used API source `e6b3844` and web source `7e0b7cf`.
The AWS owner reported both services scaled to zero and the database stopping
after discovering the flawed runtime. No AWS mutation was made from this lane.

The contained images were:

| Image | Resolved digest | Basic scan baseline |
| --- | --- | --- |
| API tag `1a9943715a5cf0b958468896d6d4adf307760c190e4711ba0ad1f0902f7c3416` | `sha256:1b0feac10c70f5b67e8e9e3935ddf3d0167d4b3535ea58d7cedf870f3fc0fd46` | 0 critical, 7 high, 1 medium, 2 undefined |
| Web tag `3cb6f791d24350fd0ed546c53a2c5514610b53aa3fcc9159267a878afab51004` | `sha256:c805ab021c3f21ca8e6e9ce938e04c882ef5efd5e7406daaa6394f21837ae779` | 0 critical, 7 high, 1 medium, 2 undefined |

Those findings remain open until replacement images are built from the reviewed
commit and rescanned. Pinning current supported base tags targets image drift;
it is not evidence that any finding is fixed.

## Image contract

- API build context: repository root, Dockerfile `Dockerfile.api`.
- Web build context: `apps/web`, Dockerfile `apps/web/Dockerfile`.
- API base: `python:3.12.14-alpine3.24`.
- Web base in all three stages: `node:22.23.2-alpine3.24`.
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

The runtime and migration task definitions accept separate Secrets Manager
ARNs containing `username` and `password`. Before deployment, the AWS owner must
create the PostgreSQL roles without exposing their values. The migrator role
needs schema migration permissions and advisory-lock access. The runtime role
needs only the application data privileges required after migration. The
runtime task must never receive the RDS master credentials.

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

The template requires `OriginDomainName`, `OriginHostedZoneId`, and an
`us-east-2` `OriginCertificateArn`. It creates a same-project Route 53 alias to
the ALB. CloudFront uses HTTPS-only to that domain, and the web task uses the
same HTTPS origin for `KALL_API_URL`. The template no longer contains an
HTTP-only CloudFront origin. This source change does not prove that DNS, the
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
