# Kall session expiry controller candidate

This is a disabled-by-default local CloudFormation candidate. It is not deployed.

The controller evaluates one stack whose name matches `kall-sandbox-[a-f0-9]{12}`. It requires an exact account, region, session identifier, expiry timestamp, and three matching stack tags. The configured lifetime must be greater than zero and no more than two hours. Before expiry it does nothing. At expiry it requests CloudFormation deletion using a stable request token. After the managed stack is absent, it disables its own EventBridge rule.

The runtime stack must retain recovery secrets and logs and use `DeletionPolicy: Snapshot` for PostgreSQL. This controller does not bypass a failed final snapshot or delete retained recovery artifacts. A failed or rollback stack state, wrong ARN, missing tag, wrong tag, excessive session duration, or wrong account/region fails closed.

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

Deployment remains blocked by the unresolved Kall image findings and the absent
external Cloudflare DNS record and matching `us-east-2` ACM certificate for
`origin.kall.skaldandstone.com`. `ControllerEnabled` defaults to `false`; no
schedule or recurring AWS resource was created by this preparation.
