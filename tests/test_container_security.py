from hashlib import sha256
from pathlib import Path

from cryptography import x509

ROOT = Path(__file__).resolve().parents[1]
RDS_CA = ROOT / "deploy" / "certs" / "aws-rds-us-east-2-bundle.pem"
RDS_CA_SHA256 = "d46e1bdfda05c8e7644e50930806a19b139a222542bf0348082fb59ece2b5fa5"
PYTHON_BASE = (
    "python:3.12.14-alpine3.24@"
    "sha256:d81968c559557b881aa557ff6d1200acec8e72a2c85fcb4ad1806e8d13e09f0b"
)
NODE_BASE = (
    "alpine:3.24.1@"
    "sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b"
)


def test_rds_bundle_is_the_reviewed_region_scoped_public_bundle() -> None:
    body = RDS_CA.read_bytes()
    certificates = x509.load_pem_x509_certificates(body)

    assert sha256(body).hexdigest() == RDS_CA_SHA256
    assert b"PRIVATE KEY" not in body
    assert len(certificates) == 3
    assert {
        certificate.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value
        for certificate in certificates
    } == {
        "Amazon RDS us-east-2 Root CA RSA2048 G1",
        "Amazon RDS us-east-2 Root CA RSA4096 G1",
        "Amazon RDS us-east-2 Root CA ECC384 G1",
    }


def test_container_base_digests_are_complete_sha256_values() -> None:
    for base in (PYTHON_BASE, NODE_BASE):
        digest = base.rsplit("@sha256:", 1)[1]

        assert len(digest) == 64
        assert all(character in "0123456789abcdef" for character in digest)


def test_api_image_runs_only_the_service_as_a_fixed_non_root_user() -> None:
    dockerfile = (ROOT / "Dockerfile.api").read_text()

    assert dockerfile.startswith(f"FROM {PYTHON_BASE} AS runtime\n")
    assert "USER 10001:10001" in dockerfile
    assert "HOME=/tmp" in dockerfile
    assert "TMPDIR=/tmp" in dockerfile
    assert "mkdir -p /app/uploads /app/generated" in dockerfile
    assert "curl" not in dockerfile.casefold()
    assert "HEALTHCHECK" in dockerfile
    assert "urllib.request.urlopen" in dockerfile
    command = dockerfile.rsplit("CMD ", 1)[1]
    assert command.startswith('["uvicorn"')
    assert "alembic" not in command
    assert '"sh"' not in command


def test_api_image_has_verified_rds_tls_defaults() -> None:
    dockerfile = (ROOT / "Dockerfile.api").read_text()

    assert "DATABASE_SSL_MODE=verify-full" in dockerfile
    assert "DATABASE_SSL_ROOT_CERT=/etc/ssl/certs/aws-rds-us-east-2-bundle.pem" in dockerfile
    assert (
        "COPY deploy/certs/aws-rds-us-east-2-bundle.pem "
        "/etc/ssl/certs/aws-rds-us-east-2-bundle.pem"
    ) in dockerfile


def test_web_image_uses_one_digest_pinned_base_for_every_stage() -> None:
    dockerfile = (ROOT / "apps" / "web" / "Dockerfile").read_text()
    from_lines = [line for line in dockerfile.splitlines() if line.startswith("FROM ")]

    assert from_lines == [
        f"FROM {NODE_BASE} AS base",
        "FROM base AS dependencies",
        "FROM base AS builder",
        "FROM base AS runtime",
    ]


def test_api_build_fails_closed_on_unreviewed_openssl_packages() -> None:
    dockerfile = (ROOT / "Dockerfile.api").read_text()

    assert "ARG ALPINE_OPENSSL_APPROVED_VERSION" in dockerfile
    assert 'test -n "${ALPINE_OPENSSL_APPROVED_VERSION}"' in dockerfile
    assert '! apk info --exists "libssl3=3.5.7-r0"' in dockerfile
    assert '! apk info --exists "libcrypto3=3.5.7-r0"' in dockerfile
    assert (
        'apk info --exists "libssl3=${ALPINE_OPENSSL_APPROVED_VERSION}"'
        in dockerfile
    )
    assert (
        'apk info --exists "libcrypto3=${ALPINE_OPENSSL_APPROVED_VERSION}"'
        in dockerfile
    )
    assert "apk info -v" not in dockerfile
    assert "sed 's/^libssl3-/" not in dockerfile
    assert "sed 's/^libcrypto3-/" not in dockerfile


def test_api_approves_only_the_reviewed_openssl_successor() -> None:
    dockerfile = (ROOT / "Dockerfile.api").read_text()

    assert 'test "${ALPINE_OPENSSL_APPROVED_VERSION}" = "3.5.8-r0"' in dockerfile


def test_web_uses_distribution_node_with_reviewed_openssl_packages() -> None:
    dockerfile = (ROOT / "apps" / "web" / "Dockerfile").read_text()
    base_stage = dockerfile.split("FROM base AS dependencies", 1)[0]

    assert dockerfile.startswith(f"FROM {NODE_BASE} AS base\n")
    assert base_stage.count("apk add --no-cache") == 1
    assert "edge" not in base_stage
    for package in (
        "nodejs=24.18.1-r0",
        "npm=11.12.1-r0",
        "libssl3=3.5.8-r0",
        "libcrypto3=3.5.8-r0",
    ):
        assert package in base_stage
    assert 'test "$(node -p process.versions.node)" = "24.18.1"' in dockerfile
    assert 'test "$(npm --version)" = "11.12.1"' in dockerfile
    assert 'test "$(node -p process.versions.openssl)" = "3.5.8"' in dockerfile
    assert '! apk info --exists "libssl3=3.5.7-r0"' in dockerfile
    assert '! apk info --exists "libcrypto3=3.5.7-r0"' in dockerfile
    assert 'apk info --exists "libssl3=3.5.8-r0"' in dockerfile
    assert 'apk info --exists "libcrypto3=3.5.8-r0"' in dockerfile
    assert 'apk info --who-owns /usr/bin/node | grep -F "nodejs-24.18.1-r0"' in dockerfile
    assert 'ldd /usr/bin/node | grep -F "/usr/lib/libssl.so.3"' in dockerfile
    assert 'ldd /usr/bin/node | grep -F "/usr/lib/libcrypto.so.3"' in dockerfile
    assert "! command -v curl >/dev/null 2>&1" in dockerfile


def test_web_image_uses_the_reviewed_non_root_node_user() -> None:
    dockerfile = (ROOT / "apps" / "web" / "Dockerfile").read_text()

    assert dockerfile.count("--chown=nextjs:nodejs") == 4
    assert "USER nextjs" in dockerfile


def test_alpha_template_separates_migration_and_runtime_privileges() -> None:
    template = (ROOT / "infrastructure" / "kall-alpha.yaml").read_text()
    api_execution = template.split("  ApiExecutionRole:\n", 1)[1].split("  BootstrapExecutionRole:\n", 1)[0]
    bootstrap_execution = template.split("  BootstrapExecutionRole:\n", 1)[1].split("  MigrationExecutionRole:\n", 1)[0]
    migration_execution = template.split("  MigrationExecutionRole:\n", 1)[1].split("  WebExecutionRole:\n", 1)[0]
    web_execution = template.split("  WebExecutionRole:\n", 1)[1].split("  ApiTaskRole:\n", 1)[0]
    runtime = template.split("  ApiTaskDefinition:", 1)[1].split("  BootstrapTaskDefinition:", 1)[0]
    bootstrap = template.split("  BootstrapTaskDefinition:", 1)[1].split("  MigrationTaskDefinition:", 1)[0]
    migration = template.split("  MigrationTaskDefinition:", 1)[1].split("  WebTaskDefinition:", 1)[0]

    assert "!Ref RuntimeDatabaseSecretArn" in api_execution
    assert "!Ref MigratorDatabaseSecretArn" not in api_execution
    assert "Database.MasterUserSecret.SecretArn" not in api_execution
    assert "Database.MasterUserSecret.SecretArn" in bootstrap_execution
    assert "!Ref MigratorDatabaseSecretArn" in bootstrap_execution
    assert "!Ref RuntimeDatabaseSecretArn" in bootstrap_execution
    assert "AppSecretArn" not in bootstrap_execution
    assert "ClerkSecretArn" not in bootstrap_execution
    assert "!Ref MigratorDatabaseSecretArn" in migration_execution
    assert "!Ref RuntimeDatabaseSecretArn" not in migration_execution
    assert "Database.MasterUserSecret.SecretArn" not in migration_execution
    assert "Resource: !Ref ClerkSecretArn" in web_execution
    assert "DatabaseSecretArn" not in web_execution
    assert "ExecutionRoleArn: !GetAtt ApiExecutionRole.Arn" in runtime
    assert "ExecutionRoleArn: !GetAtt BootstrapExecutionRole.Arn" in bootstrap
    assert "ExecutionRoleArn: !GetAtt MigrationExecutionRole.Arn" in migration
    assert "ValueFrom: !Sub '${RuntimeDatabaseSecretArn}:username::'" in runtime
    assert "ValueFrom: !Sub '${RuntimeDatabaseSecretArn}:password::'" in runtime
    assert "MasterUserSecret" not in runtime
    assert "Command: [python, -m, kall.jobs.bootstrap_database_roles]" in bootstrap
    assert "Database.MasterUserSecret.SecretArn}:username::" in bootstrap
    assert "Database.MasterUserSecret.SecretArn}:password::" in bootstrap
    assert "Command: [python, -m, kall.jobs.migrate_database]" in migration
    assert "ValueFrom: !Sub '${MigratorDatabaseSecretArn}:username::'" in migration
    assert "ValueFrom: !Sub '${MigratorDatabaseSecretArn}:password::'" in migration
    assert "User: '10001:10001'" in runtime
    assert "User: '10001:10001'" in bootstrap
    assert "User: '10001:10001'" in migration
    assert "ReadonlyRootFilesystem: true" in runtime
    assert "ReadonlyRootFilesystem: true" in bootstrap
    assert "ReadonlyRootFilesystem: true" in migration


def test_alpha_services_default_to_zero_and_require_database_evidence() -> None:
    template = (ROOT / "infrastructure" / "kall-alpha.yaml").read_text()
    parameters = template.split("Parameters:\n", 1)[1].split("Rules:\n", 1)[0]
    activation_rule = template.split("Rules:\n", 1)[1].split("Conditions:\n", 1)[0]
    services = template.split("  ApiService:\n", 1)[1].split("  ApiUnhealthyAlarm:\n", 1)[0]

    assert "  EnableApplicationServices:\n    Type: String" in parameters
    assert "    Default: 'false'" in parameters
    assert "VerifiedBootstrapRevision" in activation_rule
    assert "kall-db-roles-v1" in activation_rule
    assert "VerifiedMigrationHead" in activation_rule
    assert "20260831_0029" in activation_rule
    assert services.count("DesiredCount: !If [ApplicationServicesEnabled, 1, 0]") == 2


def test_alpha_template_references_retained_secrets_instead_of_creating_them() -> None:
    template = (ROOT / "infrastructure" / "kall-alpha.yaml").read_text()

    for parameter in ("AppSecretArn", "SensitiveDataSecretArn", "AlphaAccessSecretArn"):
        assert f"  {parameter}:\n    Type: String" in template
    assert "Type: AWS::SecretsManager::Secret" not in template
    assert "ValueFrom: !Ref AppSecretArn" in template
    assert "ValueFrom: !Ref SensitiveDataSecretArn" in template
    assert "ValueFrom: !Sub '${AlphaAccessSecretArn}:ALPHA_ALLOWED_EMAILS::'" in template


def test_alpha_template_keeps_explicit_log_and_database_retention() -> None:
    template = (ROOT / "infrastructure" / "kall-alpha.yaml").read_text()
    database = template.split("  Database:\n", 1)[1].split("  LoadBalancer:\n", 1)[0]

    assert template.count("RetentionInDays: 30") == 3
    assert "DeletionPolicy: Snapshot" in database
    assert "UpdateReplacePolicy: Snapshot" in database


def test_alpha_template_uses_verified_tls_and_preserves_release_holds() -> None:
    template = (ROOT / "infrastructure" / "kall-alpha.yaml").read_text()

    assert "Value: verify-full" in template
    assert "Value: /etc/ssl/certs/aws-rds-us-east-2-bundle.pem" in template
    assert "OriginProtocolPolicy: https-only" in template
    assert "OriginHostedZoneId" not in template
    assert "Type: AWS::Route53::RecordSet" not in template
    assert "OriginDnsRecord" not in template
    assert "AllowedValues: [origin.kall.skaldandstone.com]" in template
    assert (
        "AllowedPattern: '^arn:aws:acm:us-east-2:734702670689:certificate/"
        "[0-9a-f-]+$'"
    ) in template
    assert "DomainName: !Ref OriginDomainName" in template
    assert "Value: !GetAtt LoadBalancer.DNSName" in template
    assert "Value: !Sub https://${OriginDomainName}" in template
    assert "OriginProtocolPolicy: http-only" not in template
    assert "Value: 'false'\n            - Name: STRIPE_LIVEMODE" in template
    assert "- Name: MONITORING_ENABLED\n              Value: 'false'" in template


def test_only_webhook_bypasses_the_authenticated_web_proxy() -> None:
    template = (ROOT / "infrastructure" / "kall-alpha.yaml").read_text()
    listener_rule = template.split("  ApiListenerRule:", 1)[1].split("  ResponseHeadersPolicy:", 1)[0]

    assert "- /api/billing/webhook" in listener_rule
    assert "- /api/*" not in listener_rule


def test_reviewed_snapshot_includes_the_ca_bundle() -> None:
    snapshot_builder = (ROOT / "scripts" / "build_reviewed_snapshot.py").read_text()
    assert '"deploy/certs/"' in snapshot_builder
