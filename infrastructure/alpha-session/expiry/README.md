# Kall session expiry controller

This source template remains disabled by default. The designated AWS task owns
deployment and may enable it only for one reviewed bounded sandbox session.

The controller evaluates one stack whose name matches `kall-sandbox-[a-f0-9]{12}`. It requires an exact account, region, session identifier, expiry timestamp, and three matching stack tags. The configured lifetime must be greater than zero and no more than two hours. Before expiry it does nothing. At expiry it passes an exact, session-named deletion role to CloudFormation and requests deletion using a stable request token. If a reviewed operation reaches `DELETE_FAILED`, the checked-in controller revision supplies one deterministic recovery token with the same role. Current recovery source uses `expiry-v3` after the earlier caller-role and task-definition policy failures. After the managed stack is absent, it disables its own EventBridge rule.

The Lambda role can describe and delete only the exact runtime stack, pass only
the session's deletion role to CloudFormation, disable its own rule, and write
its own retained logs. CloudFormation alone can assume the deletion role. That
role has no create actions and no secret access. Its mutation verbs cover only
the runtime stack's EC2 security groups, ECS services and task definitions,
load-balancer resources, CloudWatch alarms, RDS instance/supporting groups,
generated runtime IAM roles, CloudFront distribution, and response-headers
policy. Regional mutations are restricted to `us-east-2`; ECS services and IAM
roles also use the runtime's exact service and stack-name patterns. AWS documents
that task-definition IAM operations do not support resource-level permissions,
and the live CloudFormation provider requested `ecs:DeregisterTaskDefinition`
against `Resource: *`. That single mutation verb therefore has a separate
wildcard statement restricted to the selected Region; all other ECS mutations
remain service-name scoped.

The runtime stack must retain recovery secrets and logs and use `DeletionPolicy: Snapshot` for PostgreSQL. This controller does not bypass a failed final snapshot or delete retained recovery artifacts. Failure states other than exact `DELETE_FAILED`, rollback states, wrong ARN, missing tag, wrong tag, excessive session duration, wrong deletion-role ARN, or wrong account/region fail closed.

The runtime stack-level tags use CloudFormation-safe hyphenated keys. The exact
contract is `SkaldAndStone-ManagedBy=kall-session-expiry-v1`,
`SkaldAndStone-SessionId=<SessionId>`, and
`SkaldAndStone-ExpiresAtEpoch=<ExpiresAtEpoch>`. Colon-delimited predecessors
are invalid for this launch path and the handler rejects them.

Generate and validate from this directory:

```powershell
powershell.exe -NoProfile -File .\make-template.ps1
python -m unittest -v test_expiry_handler.py
cfn-lint .\kall-session-expiry.yaml
aws cloudformation validate-template --template-body file://kall-session-expiry.yaml --profile skaldandstone-dev --region us-east-2
```

`ControllerEnabled` defaults to `false`. A source validation or local template
render does not create, update, or delete an AWS resource.
