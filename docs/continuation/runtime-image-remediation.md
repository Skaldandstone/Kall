# Kall runtime image remediation

This record defines the source and deployment contract for the replacement
Kall development runtime and records the reviewed API and web successor images.
It does not approve a cloud rollout.

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

## Reviewed API successor

The AWS owner built the API from exact canonical source
`c2ea5e80136fd9402d5f29b92db5ee79845b0e13` using the exact reviewed OpenSSL
argument. The source was sealed and independently checked before the build:

| Evidence | Value |
| --- | --- |
| Source manifest SHA-256 | `528281a0b9263d72e8882220b40e2bd2c6c7fd9c69ced139f2b54de12b1f7170` |
| Source archive SHA-256 | `7d7932e9f90e0461eeea6dd637064f77a9504b16667c4672276c1f949bb6970` |
| Archive inventory | 526080 bytes, 337 entries; repeat byte-identical and independent Git-byte verification passed |
| Retained source version | S3 VersionId `VJ9sZh9TXM7JPhTYuwuZ4SmCFJxX7Cxw` |
| CodeBuild build | `cb46855e-4b79-43b3-b697-30c3d886696e`, succeeded |
| Immutable image digest | `sha256:d0ec99f105678507fb63d641ac77f0c18951fce9c0a14ca3e7d15403f4b74107` |
| Image config digest | `sha256:8ddcaafb5655d2ee594a526c6533430dbf00dadc8d0eb821c89214b25ec28cca` |
| Image platform and size | `linux/amd64`, 101797094 bytes |

Immutable config and layer inspection confirms UID/GID `10001:10001`, the
Uvicorn-only runtime command, Python health check, `verify-full` with the fixed
Region CA path, CA SHA-256
`d46e1bdfda05c8e7644e50930806a19b139a222542bf0348082fb59ece2b5fa5`,
`libssl3=3.5.8-r0`, `libcrypto3=3.5.8-r0`, and no curl, Alembic runtime command,
or secret-like environment values. ECR basic scanning completed with zero
findings. Amazon Inspector enhanced ECR scanning is disabled, so this is not an
enhanced-scan claim.

This completes the API build and basic-scan gate. It does not clear database
activation, constrained Fargate execution, TLS, provider, or hosted acceptance
gates. The two rejected source attempts created no image, tag, or push and are
not reusable release inputs.

## Reviewed web successor

The AWS owner built the web image from exact canonical source
`9bb8377a5754d2484559db8513a6624135ec91be`. The accepted source ZIP was created
from immutable Git objects after a working-tree archive with CRLF-normalized
bytes was rejected.

| Evidence | Value |
| --- | --- |
| Source tree | `b6be8ee7180a727920843436817f5ba869e7ed35` |
| Source manifest SHA-256 | `789c78b6acdd2a47019852299a3a262fb8e23b122b5be39728c845914c4a14ec` |
| Source archive SHA-256 | `47a5dd0c8e66d4ba44fdff616488f8365c7a7e927a00cb08033c0f66ec5e2121` |
| Archive inventory | 21545305 bytes, 709 entries; zero CRC, path, duplicate, hash, or Git-byte mismatches |
| Retained source version | S3 VersionId `BH90YNA0uyyrMrzh6GF.eF.iZb.iWly7` |
| CodeBuild build | `ecc79734-9b38-4fae-be9a-d069e52585d3`, succeeded |
| Immutable image digest | `sha256:d541a72875a4930af7b48817065d3408d92319343f2f17eddfa524e2b0736bd2` |
| Image config digest | `sha256:6140db5596c9ab71e0564d3330e81e6cab96f357652d20d5b00855e25fb1d18e` |
| Image platform | `linux/amd64` |

Immutable config and final-rootfs layer inspection confirms nonroot user
`nextjs`, command `npm run start`, the exact source label, only the expected
Node, telemetry, port, and hostname environment values, Alpine 3.24.1,
`nodejs=24.18.1-r0`, `npm=11.12.1-r0`, and
`libssl3/libcrypto3=3.5.8-r0`. The Node executable SHA-256 starts with
`af89883f` and its ELF dependencies include `libssl.so.3` and `libcrypto.so.3`.
Curl is absent. BusyBox wget remains present as documented in the source
contract. ECR basic scanning completed with zero findings at 21:02:46 Pacific
time on 2026-08-31. Amazon Inspector enhanced ECR scanning is disabled, so this
is not an enhanced-scan claim.

This completes the web build and basic-scan gate. A separate no-source pull
diagnostic could not run because the least-privilege build role intentionally
lacks `ecr:BatchGetImage`; IAM was not broadened. Direct ECR manifest, config,
and layer inspection supplied the immutable evidence instead. No runtime was
activated.

## Image contract

- API build context: repository root, Dockerfile `Dockerfile.api`.
- Web build context: `apps/web`, Dockerfile `apps/web/Dockerfile`.
- API base: `python:3.12.14-alpine3.24`, pinned to index digest
  `sha256:d81968c559557b881aa557ff6d1200acec8e72a2c85fcb4ad1806e8d13e09f0b`.
  Its reviewed `linux/amd64` manifest is
  `sha256:78e98729f8fc4099e53cffb3fe59fd15b18dfa4ace8c914dee0cefa5320068eb`
  and its immutable package database contains `libssl3=3.5.8-r0` and
  `libcrypto3=3.5.8-r0`.
- Web base: `alpine:3.24.1`, pinned to index digest
  `sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b`.
  All web stages derive from this base and install exact distribution packages
  `nodejs=24.18.1-r0`, `npm=11.12.1-r0`, and
  `libssl3/libcrypto3=3.5.8-r0`.
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

Both Dockerfiles fail before dependency installation when the effective
`libssl3` or `libcrypto3` version is `3.5.7-r0`, but the two images now obtain
Node and Python differently.

The reviewed Python base has advanced to `3.5.8-r0`. The API Dockerfile accepts
only that exact build argument and validates both installed packages against it.
The reviewed API output above has passed the reproducible build, immutable
inspection, and basic-scan gate.

The official Node `24.20.0-alpine3.24` and `24.20.0-bookworm-slim` images were
both rejected. The Alpine image still installs `3.5.7-r0`; the Debian image
omits the Debian OpenSSL packages but its Node executable bundles OpenSSL
`3.5.7`. Changing only the OS family would have hidden the affected package
without repairing Node's runtime.

The web Dockerfile instead starts from official `alpine:3.24.1` index digest
`sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b`
and installs Alpine's exact LTS distribution packages in one transaction:
`nodejs=24.18.1-r0`, `npm=11.12.1-r0`, `libssl3=3.5.8-r0`, and
`libcrypto3=3.5.8-r0`. A negative diagnostic proved that omitting the two
explicit OpenSSL upgrades leaves the base-provided `3.5.7-r0` libraries. The
corrected diagnostic reports `process.versions.openssl=3.5.8`, and `ldd` proves
that `/usr/bin/node` loads `/usr/lib/libssl.so.3` and
`/usr/lib/libcrypto.so.3`. The Dockerfile verifies those facts, the exact
package versions and ownership, the rejected-version absence, and curl absence
before installing application dependencies. BusyBox still exposes its wget
applet; this image does not claim to be wget-free.

The Dockerfiles use `apk info --exists` with exact `name=version` constraints
and do not parse human-readable `apk info -v` output. Each gate independently
rejects the affected version and requires both installed libraries to satisfy
the reviewed exact version.

Do not work around the gate with an unbounded `apk upgrade`, a floating base
tag, or an unreviewed alternate image. For each future refresh:

1. Review the official base manifest and update its pinned index digest.
2. Confirm the signed Alpine stable indexes still provide every exact package.
3. Confirm Node dynamically loads the reviewed OpenSSL libraries and reports
   the same version at runtime.
4. Record immutable output digests and rescan them in ECR.
5. Keep the launch gate closed until every critical, high, and undefined
   finding is reviewed.

The packaged-Node diagnostic was source-input evidence only. The reviewed Kall
web build, immutable output inspection, and ECR basic scan are recorded above.
They do not establish constrained runtime behavior or approve cloud activation.

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
   usernames `kalladmin`, `kall_migrator`, and `kall_runtime`, requires a
   nonempty AWS-managed master password and distinct migrator/runtime passwords
   of at least 32 characters, and connects with `verify-full` using the checked-in
   Region CA. It creates or rotates the two application roles using only role
   attributes that the non-superuser RDS master can alter. A postcondition
   requires both roles to exist with login enabled, inheritance disabled, and
   every superuser, database-creation, role-creation, replication, and RLS-bypass
   flag false. It removes public schema creation, gives DDL only to the migrator,
   gives data access only to the runtime role, and installs runtime default
   privileges for objects the migrator creates. Existing elevated roles or
   public objects owned by another role stop the transaction for explicit review.
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
and calls the API at `/api/*`. The mobile app and browser extension also use
the direct `/api/*` surface with their own Clerk bearer tokens. The ALB therefore
routes `/api/kall/*` to the web target at priority 10 and `/api/*` to FastAPI at
priority 20. The explicit higher-priority web rule prevents the broader API
rule from bypassing the Next proxy. A route-dependency audit at this revision
found authentication on every nonpublic FastAPI route. The intentional public
exceptions are health/readiness, published career pages, token-protected
testimonial responses, and the signature-verified Stripe webhook. The webhook
remains dormant while sandbox billing is disabled and no registration is
authorized.

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

1. Wait for and review the official Node successor, then build the web image from
   an exact reviewed commit and record its source manifest and immutable image
   digests. The API evidence is recorded above.
2. Scan the web image and review every high, critical, and undefined result. The
   old web findings are not waived. The API basic scan is clear; enhanced ECR
   scanning remains unavailable.
3. Retain the inspected API configuration evidence above when selecting the
   immutable image for runtime validation.
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
