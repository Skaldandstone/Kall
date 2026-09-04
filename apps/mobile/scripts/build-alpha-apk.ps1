[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://.+/api$')]
    [string]$ApiBaseUrl,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^pk_(test|live)_')]
    [string]$ClerkPublishableKey,

    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist')
)

$ErrorActionPreference = 'Stop'
$mobileRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$credentialRoot = Join-Path $env:USERPROFILE '.kall\android'
$keyStorePath = Join-Path $credentialRoot 'kall-alpha.jks'
$passwordPath = Join-Path $credentialRoot 'kall-alpha-password.dpapi'
$keyAlias = 'kall-alpha'

function Protect-CredentialDirectory {
    if (-not (Test-Path -LiteralPath $credentialRoot)) {
        New-Item -ItemType Directory -Path $credentialRoot | Out-Null
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $credentialRoot /inheritance:r | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove inherited access from the Android credential directory.' }
    & icacls.exe $credentialRoot /grant:r "${identity}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the Android credential directory to the current Windows user.' }
}

function New-AlphaSigningMaterial {
    Protect-CredentialDirectory
    $randomBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
    $plainPassword = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
    ConvertFrom-SecureString -SecureString $securePassword | Set-Content -LiteralPath $passwordPath -NoNewline

    $env:KALL_KEYSTORE_PASSWORD = $plainPassword
    $env:KALL_KEY_PASSWORD = $plainPassword
    try {
        $keytool = (Get-Command keytool.exe -ErrorAction Stop).Source
        & $keytool -genkeypair -keystore $keyStorePath -alias $keyAlias -keyalg RSA -keysize 4096 -validity 10000 `
            -dname 'CN=Kall Alpha, OU=Mobile, O=Skald and Stone LLC, C=US' `
            -storepass:env KALL_KEYSTORE_PASSWORD -keypass:env KALL_KEY_PASSWORD -noprompt
        if ($LASTEXITCODE -ne 0) { throw 'Android signing-key generation failed.' }
    }
    finally {
        Remove-Item Env:KALL_KEYSTORE_PASSWORD, Env:KALL_KEY_PASSWORD -ErrorAction SilentlyContinue
        $plainPassword = $null
        [Array]::Clear($randomBytes, 0, $randomBytes.Length)
    }
}

if ((Test-Path -LiteralPath $keyStorePath) -xor (Test-Path -LiteralPath $passwordPath)) {
    throw 'Android signing material is incomplete. Restore both local credential files before building.'
}
if (-not (Test-Path -LiteralPath $keyStorePath)) {
    New-AlphaSigningMaterial
}

Protect-CredentialDirectory
$securePassword = Get-Content -LiteralPath $passwordPath -Raw | ConvertTo-SecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)

$previousLocation = Get-Location
try {
    $env:NODE_ENV = 'production'
    $env:KALL_MOBILE_RELEASE = '1'
    $env:KALL_MOBILE_LOCAL_ANDROID_SIGNING = '1'
    $env:API_BASE_URL = $ApiBaseUrl
    $env:EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = $ClerkPublishableKey
    $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:ORG_GRADLE_PROJECT_KALL_RELEASE_STORE_FILE = $keyStorePath.Replace('\', '/')
    $env:ORG_GRADLE_PROJECT_KALL_RELEASE_STORE_PASSWORD = $plainPassword
    $env:ORG_GRADLE_PROJECT_KALL_RELEASE_KEY_ALIAS = $keyAlias
    $env:ORG_GRADLE_PROJECT_KALL_RELEASE_KEY_PASSWORD = $plainPassword

    Set-Location -LiteralPath $mobileRoot
    & npx expo prebuild --platform android --clean --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo Android prebuild failed.' }
    & .\android\gradlew.bat -p .\android assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }

    $sourceApk = Join-Path $mobileRoot 'android\app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $sourceApk)) { throw 'Gradle completed without producing the release APK.' }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $outputPath = Join-Path (Resolve-Path -LiteralPath $OutputDirectory).Path 'Kall-alpha-1.0.0.apk'
    Copy-Item -LiteralPath $sourceApk -Destination $outputPath -Force
    $hash = Get-FileHash -LiteralPath $outputPath -Algorithm SHA256
    Set-Content -LiteralPath "$outputPath.sha256" -Value "$($hash.Hash)  Kall-alpha-1.0.0.apk"
    Write-Output "APK: $outputPath"
    Write-Output "SHA256: $($hash.Hash)"
}
finally {
    Set-Location -LiteralPath $previousLocation
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $plainPassword = $null
    Remove-Item Env:NODE_ENV, Env:KALL_MOBILE_RELEASE, Env:KALL_MOBILE_LOCAL_ANDROID_SIGNING, Env:API_BASE_URL, Env:EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, `
        Env:ANDROID_HOME, Env:ANDROID_SDK_ROOT, Env:ORG_GRADLE_PROJECT_KALL_RELEASE_STORE_FILE, `
        Env:ORG_GRADLE_PROJECT_KALL_RELEASE_STORE_PASSWORD, Env:ORG_GRADLE_PROJECT_KALL_RELEASE_KEY_ALIAS, `
        Env:ORG_GRADLE_PROJECT_KALL_RELEASE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
