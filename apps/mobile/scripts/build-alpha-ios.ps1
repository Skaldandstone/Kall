[CmdletBinding()]
param(
    [ValidateSet('Simulator', 'Device')]
    [string]$Target = 'Simulator',

    [switch]$Wait
)

$ErrorActionPreference = 'Stop'
$mobileRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$profile = if ($Target -eq 'Simulator') { 'ios-simulator-alpha' } else { 'ios-device-alpha' }
$easVersion = '23.2.0'

Set-Location -LiteralPath $mobileRoot
& npm.cmd run validate:ios-alpha
if ($LASTEXITCODE -ne 0) { throw 'iOS alpha configuration validation failed.' }

& npx.cmd --yes "eas-cli@$easVersion" whoami
if ($LASTEXITCODE -ne 0) {
    throw "Expo authentication is required. Run 'npx eas-cli@$easVersion login', then rerun this script."
}

$arguments = @('--yes', "eas-cli@$easVersion", 'build', '--platform', 'ios', '--profile', $profile)
if (-not $Wait) { $arguments += '--no-wait' }
& npx.cmd @arguments
if ($LASTEXITCODE -ne 0) { throw "EAS iOS $Target build did not start successfully." }
