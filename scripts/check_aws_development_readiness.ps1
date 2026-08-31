[CmdletBinding()]
param(
    [string]$Profile = 'skaldandstone-dev',
    [string]$ExpectedProjectId = '734702670689',
    [string]$ExpectedRegion = 'us-east-2'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI is required.'
}

$configuredRegion = (aws configure get region --profile $Profile).Trim()
if ($LASTEXITCODE -ne 0 -or $configuredRegion -ne $ExpectedRegion) {
    throw "Profile $Profile must use the selected Region $ExpectedRegion. Found: $configuredRegion"
}

$identity = aws sts get-caller-identity --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $ExpectedProjectId) {
    throw "Profile $Profile is not authenticated to expected AWS project $ExpectedProjectId."
}

$plan = aws freetier get-account-plan-state --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'Could not read the AWS project plan state.'
}

$clerk = aws secretsmanager describe-secret --secret-id dev/kall/clerk --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'The dev/kall/clerk record is unavailable.'
}

$stripe = aws secretsmanager describe-secret --secret-id dev/kall/stripe --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'The dev/kall/stripe record is unavailable.'
}

$clusters = aws ecs list-clusters --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
$databases = aws rds describe-db-instances --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
$loadBalancers = aws elbv2 describe-load-balancers --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json

[ordered]@{
    projectId = $identity.Account
    selectedRegion = $configuredRegion
    projectPlan = $plan.accountPlanType
    clerkSecretVersion = $clerk.VersionIdsToStages.PSObject.Properties.Name | Select-Object -First 1
    stripeSecretVersion = $stripe.VersionIdsToStages.PSObject.Properties.Name | Select-Object -First 1
    ecsClusterCount = @($clusters.clusterArns).Count
    databaseCount = @($databases.DBInstances).Count
    loadBalancerCount = @($loadBalancers.LoadBalancers).Count
    secretsRead = $false
} | ConvertTo-Json -Depth 4
