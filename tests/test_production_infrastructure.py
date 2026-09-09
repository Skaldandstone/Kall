from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "infrastructure" / "kall-production.yaml"
GUARD = ROOT / "infrastructure" / "production" / "kall-production.guard"


def _template() -> str:
    return TEMPLATE.read_text()


def _section(body: str, start: str, end: str) -> str:
    return body.split(start, 1)[1].split(end, 1)[0]


def test_production_template_is_separate_durable_and_region_bounded() -> None:
    template = _template()

    assert "Durable invite-only Kall production runtime" in template
    assert "AWSAgentToolkit: aws-cloudformation@2" in template
    assert "us-east-2" in template
    assert "051722405355" in template
    assert "734702670689" not in template
    assert "kall-alpha" not in template
    assert "skald-dev-734702670689-kall-storage" not in template
    assert "AWS::Lambda::Function" not in template
    assert "AWS::Route53::RecordSet" not in template
    assert "ExpiresAt" not in template


def test_production_images_require_immutable_reviewed_ecr_digests() -> None:
    template = _template()
    parameters = _section(template, "Parameters:\n", "Rules:\n")

    assert parameters.count("@sha256:[0-9a-f]{64}") == 2
    assert r"051722405355\.dkr\.ecr\.us-east-2\.amazonaws\.com/kall-api@sha256" in parameters
    assert r"051722405355\.dkr\.ecr\.us-east-2\.amazonaws\.com/kall-web@sha256" in parameters
    assert ":latest" not in parameters


def test_production_secrets_are_isolated_retained_and_least_privilege() -> None:
    template = _template()
    app_secret = _section(template, "  AppSecret:\n", "  SensitiveDataSecret:\n")
    sensitive_secret = _section(
        template, "  SensitiveDataSecret:\n", "  RuntimeDatabaseSecret:\n"
    )
    runtime_secret = _section(
        template, "  RuntimeDatabaseSecret:\n", "  MigratorDatabaseSecret:\n"
    )
    migrator_secret = _section(
        template, "  MigratorDatabaseSecret:\n", "  ApiExecutionRole:\n"
    )
    api_execution = _section(
        template, "  ApiExecutionRole:\n", "  BootstrapExecutionRole:\n"
    )
    bootstrap_execution = _section(
        template, "  BootstrapExecutionRole:\n", "  MigrationExecutionRole:\n"
    )
    migration_execution = _section(
        template, "  MigrationExecutionRole:\n", "  WebExecutionRole:\n"
    )

    for secret in (app_secret, sensitive_secret, runtime_secret, migrator_secret):
        assert "Type: AWS::SecretsManager::Secret" in secret
        assert "DeletionPolicy: Retain" in secret
        assert "UpdateReplacePolicy: Retain" in secret
    assert 'SecretStringTemplate: \'{"username":"kall_runtime"}\'' in runtime_secret
    assert 'SecretStringTemplate: \'{"username":"kall_migrator"}\'' in migrator_secret
    assert "!Ref RuntimeDatabaseSecret" in api_execution
    assert "MigratorDatabaseSecret" not in api_execution
    assert "MasterUserSecret" not in api_execution
    assert "Database.MasterUserSecret.SecretArn" in bootstrap_execution
    assert "!Ref RuntimeDatabaseSecret" in bootstrap_execution
    assert "!Ref MigratorDatabaseSecret" in bootstrap_execution
    assert "!Ref MigratorDatabaseSecret" in migration_execution
    assert "RuntimeDatabaseSecret" not in migration_execution
    assert "MasterUserSecret" not in migration_execution
    assert "secret:prod/kall/clerk-" in template
    assert "secret:prod/kall/access-" in template
    assert "secret:dev/kall" not in template


def test_production_documents_are_private_encrypted_versioned_and_retained() -> None:
    template = _template()
    bucket = _section(template, "  DocumentBucket:\n", "  DocumentBucketPolicy:\n")
    policy = _section(template, "  DocumentBucketPolicy:\n", "  OperationsTopic:\n")
    task_role = _section(template, "  ApiTaskRole:\n", "  WebTaskRole:\n")

    assert "DeletionPolicy: Retain" in bucket
    assert "UpdateReplacePolicy: Retain" in bucket
    assert "SSEAlgorithm: AES256" in bucket
    assert "BlockPublicAcls: true" in bucket
    assert "BlockPublicPolicy: true" in bucket
    assert "IgnorePublicAcls: true" in bucket
    assert "RestrictPublicBuckets: true" in bucket
    assert "ObjectOwnership: BucketOwnerEnforced" in bucket
    assert "VersioningConfiguration:\n        Status: Enabled" in bucket
    assert "aws:SecureTransport: 'false'" in policy
    assert "Resource: !GetAtt DocumentBucket.Arn" in task_role
    assert "!Sub '${DocumentBucket.Arn}/*'" in task_role


def test_production_database_is_private_resilient_and_protected() -> None:
    template = _template()
    database = _section(template, "  Database:\n", "  LoadBalancer:\n")

    assert "DeletionPolicy: Snapshot" in database
    assert "UpdateReplacePolicy: Snapshot" in database
    assert "EngineVersion: '16.15'" in database
    assert "StorageEncrypted: true" in database
    assert "PubliclyAccessible: false" in database
    assert "MultiAZ: true" in database
    assert "BackupRetentionPeriod: 7" in database
    assert "DeletionProtection: true" in database
    assert "ManageMasterUserPassword: true" in database
    assert "EnablePerformanceInsights: true" in database
    assert "DBInstanceIdentifier:" not in database


def test_production_activation_and_billing_fail_closed() -> None:
    template = _template()
    parameters = _section(template, "Parameters:\n", "Rules:\n")
    rules = _section(template, "Rules:\n", "Conditions:\n")
    api_task = _section(template, "  ApiTaskDefinition:\n", "  BootstrapTaskDefinition:\n")
    services = _section(template, "  ApiService:\n", "  ApiUnhealthyAlarm:\n")

    assert "  EnableApplicationServices:\n    Type: String" in parameters
    assert "  EnableStripeLive:\n    Type: String" in parameters
    assert parameters.count("    Default: 'false'") >= 2
    assert "ApplicationActivationRequiresDatabaseEvidence" in rules
    assert "kall-db-roles-v1" in rules
    assert "20260909_0035" in rules
    assert "StripeActivationRequiresLiveCatalog" in rules
    assert "stripe-disabled" in rules
    assert "RevenueCatActivationRequiresCatalog" in rules
    assert "revenuecat-disabled" in rules
    assert services.count("DesiredCount: !If [ApplicationServicesEnabled, 1, 0]") == 2
    assert "Value: !Ref EnableStripeLive" in api_task
    assert "- Name: STRIPE_LIVEMODE\n              Value: !Ref EnableStripeLive" in api_task
    assert "Value: kall:production" in api_task
    assert "- Name: REVENUECAT_ENABLED\n              Value: !Ref EnableRevenueCatNative" in api_task
    assert "REVENUECAT_WEBHOOK_AUTHORIZATION" in api_task
    assert "REVENUECAT_WEBHOOK_SIGNING_SECRET" in api_task
    assert "Value: 'false'\n            - Name: MONITORING_ENABLED" not in api_task
    assert "- Name: MONITORING_ENABLED\n              Value: 'false'" in api_task
    assert "price_1UAZ" not in template
    assert "prod_VAv" not in template


def test_production_migration_receives_complete_fail_closed_settings() -> None:
    migration = _section(
        _template(), "  MigrationTaskDefinition:\n", "  WebTaskDefinition:\n"
    )

    assert "- Name: FRONTEND_URL\n              Value: !Sub https://${PublicDomainName}" in migration
    assert "- Name: CLERK_AUTHORIZED_PARTIES\n              Value: !Sub https://${PublicDomainName}" in migration
    assert "- Name: AWS_REGION\n              Value: us-east-2" in migration
    assert "- Name: AWS_S3_BUCKET\n              Value: !Ref DocumentBucket" in migration
    assert (
        "- Name: ALPHA_INVITE_ONLY\n"
        "              Value: !If [PublicSignupEnabled, 'false', 'true']"
    ) in migration
    assert "- Name: STRIPE_ENABLED\n              Value: 'false'" in migration
    assert "- Name: MONITORING_ENABLED\n              Value: 'false'" in migration


def test_public_signup_is_parameterised_and_fails_closed() -> None:
    """Opening registration must be a deliberate parameter flip, never a default.

    All three task definitions have to agree: a template where the API opened up
    but the web tier still advertised invite-only copy would be worse than either
    state on its own.
    """
    template = _template()

    assert "  EnablePublicSignup:\n" in template
    signup_param = _section(
        template, "  EnablePublicSignup:\n", "  VerifiedBootstrapRevision:\n"
    )
    assert "AllowedValues: ['true', 'false']" in signup_param
    assert "Default: 'false'" in signup_param

    assert "PublicSignupEnabled: !Equals [!Ref EnablePublicSignup, 'true']" in template
    assert (
        template.count(
            "- Name: ALPHA_INVITE_ONLY\n"
            "              Value: !If [PublicSignupEnabled, 'false', 'true']"
        )
        == 3
    )
    # The allowlist secret stays wired in regardless, so invite-only can be
    # restored without redeploying configuration that was deleted.
    assert "ProductionAccessSecretArn" in template


def test_production_routing_tls_identity_and_observability_contracts() -> None:
    template = _template()
    distribution = _section(template, "  Distribution:\n", "  ApiTaskDefinition:\n")
    proxy_rule = _section(
        template, "  WebProxyListenerRule:\n", "  ApiListenerRule:\n"
    )
    api_rule = _section(
        template, "  ApiListenerRule:\n", "  ResponseHeadersPolicy:\n"
    )
    api_task = _section(template, "  ApiTaskDefinition:\n", "  BootstrapTaskDefinition:\n")

    assert "DeletionPolicy: Retain" in distribution
    assert "OriginProtocolPolicy: https-only" in distribution
    assert "MinimumProtocolVersion: TLSv1.2_2021" in distribution
    assert "CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad" in distribution
    assert "Priority: 5" in proxy_rule and "/api/kall/*" in proxy_rule
    assert "Priority: 10" in api_rule and "/api/*" in api_rule
    assert "TargetGroupArn: !Ref ApiTargetGroup" in api_rule
    assert "CLERK_AUTHORIZED_PARTIES" in api_task
    assert "Value: !Sub https://${PublicDomainName}" in api_task
    assert "Value: verify-full" in api_task
    assert "OperationsTopic" in template
    assert "AllowStackCloudWatchAlarms" in template
    assert "alarm:${AWS::StackName}-*" in template
    assert template.count("AlarmActions: [!Ref OperationsTopic]") == 6
    assert "ApiTarget5xxAlarm" in template
    assert "WebTarget5xxAlarm" in template
    assert "DatabaseFreeStorageAlarm" in template
    assert "DatabaseCpuAlarm" in template


def test_public_alias_can_be_transferred_without_weakening_tls() -> None:
    template = _template()
    parameters = _section(template, "Parameters:\n", "Rules:\n")
    conditions = _section(template, "Conditions:\n", "Resources:\n")
    distribution = _section(template, "  Distribution:\n", "  ApiTaskDefinition:\n")

    alias_parameter = parameters.split("  AttachPublicAlias:\n", 1)[1]
    assert "AllowedValues: ['true', 'false']" in alias_parameter
    assert "Default: 'true'" in alias_parameter
    assert "PublicAliasAttached: !Equals [!Ref AttachPublicAlias, 'true']" in conditions
    assert (
        "Aliases: !If [PublicAliasAttached, [!Ref PublicDomainName], !Ref AWS::NoValue]"
        in distribution
    )
    assert "AcmCertificateArn: !Ref ViewerCertificateArn" in distribution
    assert "MinimumProtocolVersion: TLSv1.2_2021" in distribution


def test_sentry_dsns_are_optional_plaintext_parameters_not_secrets() -> None:
    """A Sentry DSN can only send events to one project, so it is public by
    design and travels as a plain task variable - never through Secrets
    Manager, and never as a web build argument (the root layout serves it to
    the browser at request time, so no image rebuild is needed)."""
    template = _template()
    parameters = _section(template, "Parameters:\n", "Conditions:\n")
    api_task = _section(template, "  ApiTaskDefinition:\n", "  BootstrapTaskDefinition:\n")
    web_task = _section(template, "  WebTaskDefinition:\n", "  ApiService:\n")

    for name in ("SentryApiDsn", "SentryWebDsn"):
        parameter = _section(parameters, f"  {name}:\n", "    Description:")
        assert "Default: ''" in parameter, f"{name} must default to inert"
        assert "ingest" in parameter and "sentry" in parameter, f"{name} must only accept a DSN"

    for task, ref in ((api_task, "SentryApiDsn"), (web_task, "SentryWebDsn")):
        environment = _section(task, "          Environment:\n", "          Secrets:\n")
        secrets = _section(task, "          Secrets:\n", "          LogConfiguration:\n")
        assert f"- Name: SENTRY_DSN\n              Value: !Ref {ref}" in environment
        assert "- Name: SENTRY_ENVIRONMENT\n              Value: production" in environment
        assert "SENTRY" not in secrets


def test_production_guard_covers_release_critical_invariants() -> None:
    guard = GUARD.read_text()

    for rule in (
        "services_and_live_billing_default_disabled",
        "public_signup_defaults_closed",
        "application_activation_requires_database_evidence",
        "stateful_resources_are_retained",
        "production_database_is_private_resilient_and_protected",
        "production_documents_are_private_encrypted_and_versioned",
        "production_delivery_is_https_only",
        "alarms_publish_only_to_the_stack_topic",
    ):
        assert f"rule {rule} {{" in guard

    # Rule names alone prove nothing; the fail-closed defaults are the point.
    assert "Parameters.EnablePublicSignup.Default == 'false'" in guard
    assert "Parameters.EnableStripeLive.Default == 'false'" in guard
    assert "Parameters.EnableApplicationServices.Default == 'false'" in guard
    assert "'20260909_0035'" in guard
