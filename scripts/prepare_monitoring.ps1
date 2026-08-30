# Offline review only. This script never invokes AWS or creates resources.
param(
    [decimal]$EstimatedMonthlyUsd = 0,
    [switch]$PrepareReviewPackage
)
$ErrorActionPreference = 'Stop'
if (-not $PrepareReviewPackage) {
    Write-Output 'Monitoring deployment is disabled. Review docs/continuation/monitoring.md first.'
    exit 0
}
if ($EstimatedMonthlyUsd -le 0 -or $EstimatedMonthlyUsd -gt 10) {
    throw 'Provide the complete incremental monthly estimate, greater than zero and at most $10. Deployment remains disabled.'
}
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$template = Join-Path $workspace 'deploy/monitoring.disabled.yaml'
if (-not (Select-String -LiteralPath $template -SimpleMatch 'State: DISABLED' -Quiet)) {
    throw 'The review template must keep its schedule disabled.'
}
Write-Output "Review template: $template"
Write-Output "Review estimate: USD $EstimatedMonthlyUsd / month. No deployment performed."
Write-Output 'Selected Region must be us-east-2. Confirm it under AWS Settings > View all projects > Overview > Additional Info > Region.'
Write-Output 'Before approval: rerun controlled feeds, validate PostgreSQL concurrency, inspect least-privilege roles and public subnet routes, verify sender, and reconcile the complete cost worksheet.'
