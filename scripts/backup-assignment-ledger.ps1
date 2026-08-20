param(
  [string]$BackupRoot = "$PSScriptRoot\..\data\backups"
)

$ErrorActionPreference = "Stop"
$projectPath = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectPath "data\assignment-ledger"

if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "The durable assignment ledger does not exist at $sourcePath"
}

Push-Location $projectPath
try {
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    throw "Stop the local dashboard and allow any listener run to finish before creating a backup."
  }

  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  $destination = Join-Path $BackupRoot ([DateTimeOffset]::Now.ToString("yyyyMMdd-HHmmss"))
  Copy-Item -LiteralPath $sourcePath -Destination $destination -Recurse
  Write-Output "Assignment ledger backup created: $destination"
} finally {
  Pop-Location
}
