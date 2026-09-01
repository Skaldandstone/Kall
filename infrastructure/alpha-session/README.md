# Kall bounded alpha session

This directory preserves the reviewed cost and expiry controls for a future
Kall alpha session. Nothing here is deployed automatically.

The captured public Ohio rates in `regional-prices.json` produced the checked-in
`cost-model.json`. The modeled two-hour session uses twelve resource-hours and
rounds up to USD17.65 without credits or free-tier reductions. A cleanup delayed
by 24 hours reaches USD25.61 and fails the USD20 scenario. The worksheet is a
planning ceiling, not an AWS invoice cap.

The `expiry` directory contains a disabled-by-default CloudFormation controller.
It accepts only one correctly named and tagged Kall sandbox stack, rejects a
session longer than two hours, deletes only that exact stack after expiry, and
disables its own schedule after the stack is absent. The runtime stack must keep
its own secret, log, and final-snapshot retention policies.

Run the local evidence from this directory:

```powershell
python .\cost_model.py
python -m unittest -v .\test_cost_model.py
Set-Location -LiteralPath .\expiry
powershell.exe -NoProfile -File .\make-template.ps1
python -m unittest -v .\test_expiry_handler.py
```

The AWS owner validated the imported predecessor with cfn-lint, five cfn-guard
rules, and AWS CloudFormation validation in `us-east-2`. The checked-in template
was regenerated only to normalize Python imports and passed the 13 local tests,
Ruff, and cfn-lint. It has not been validated or deployed in AWS. Image findings
and external DNS/certificate setup still block deployment.
