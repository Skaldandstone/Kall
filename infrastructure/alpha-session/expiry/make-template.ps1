param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$sourcePath = Join-Path $root 'kall-session-expiry.template.yaml'
$handlerPath = Join-Path $root 'expiry_handler.py'
$targetPath = Join-Path $root 'kall-session-expiry.yaml'
$template = Get-Content -LiteralPath $sourcePath -Raw
$handler = Get-Content -LiteralPath $handlerPath -Raw
$indented = (($handler -split "`r?`n") | ForEach-Object {
  if ($_ -eq '') { '' } else { '          ' + $_ }
}) -join "`n"
$rendered = $template.Replace('          __EXPIRY_HANDLER__', $indented)
if ($rendered -eq $template -or $rendered.Contains('__EXPIRY_HANDLER__')) {
  throw 'Expiry handler placeholder was not rendered exactly once.'
}
if (Test-Path -LiteralPath $targetPath) {
  $existing = Get-Content -LiteralPath $targetPath -Raw
  if ($existing -ne $rendered) {
    if (-not $Force) {
      throw 'Refusing to overwrite a different rendered expiry template without -Force.'
    }
    [IO.File]::WriteAllText($targetPath, $rendered, [Text.UTF8Encoding]::new($false))
  }
} else {
  [IO.File]::WriteAllText($targetPath, $rendered, [Text.UTF8Encoding]::new($false))
}
Get-FileHash -LiteralPath $targetPath -Algorithm SHA256 | Select-Object Path, Hash
