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

$planJson = aws freetier get-account-plan-state --profile $Profile --region $ExpectedRegion --output json 2>$null
if ($LASTEXITCODE -eq 0) {
    $projectPlan = ($planJson | ConvertFrom-Json).accountPlanType
    $projectPlanNote = 'Confirmed by aws freetier get-account-plan-state.'
} else {
    # The new AWS experience currently returns ResourceNotFoundException for
    # some valid projects. Keep the resource audit useful while making the
    # missing billing fact explicit rather than guessing FREE or PAID.
    $projectPlan = 'UNAVAILABLE'
    $projectPlanNote = 'Confirm the plan and spend status in AWS Settings > Billing.'
}

$clerk = aws secretsmanager describe-secret --secret-id dev/kall/clerk --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'The dev/kall/clerk record is unavailable.'
}

$stripe = aws secretsmanager describe-secret --secret-id dev/kall/stripe --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'The dev/kall/stripe record is unavailable.'
}

$openAiJson = aws secretsmanager describe-secret --secret-id dev/kall/openai --profile $Profile --region $ExpectedRegion --output json 2>$null
$openAiConfigured = $LASTEXITCODE -eq 0

$clusters = aws ecs list-clusters --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
$databases = aws rds describe-db-instances --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json
$loadBalancers = aws elbv2 describe-load-balancers --profile $Profile --region $ExpectedRegion --output json | ConvertFrom-Json

[ordered]@{
    projectId = $identity.Account
    selectedRegion = $configuredRegion
    projectPlan = $projectPlan
    projectPlanNote = $projectPlanNote
    clerkSecretVersion = $clerk.VersionIdsToStages.PSObject.Properties.Name | Select-Object -First 1
    stripeSecretVersion = $stripe.VersionIdsToStages.PSObject.Properties.Name | Select-Object -First 1
    openAiSecretConfigured = $openAiConfigured
    ecsClusterCount = @($clusters.clusterArns).Count
    databaseCount = @($databases.DBInstances).Count
    loadBalancerCount = @($loadBalancers.LoadBalancers).Count
    secretsRead = $false
} | ConvertTo-Json -Depth 4
