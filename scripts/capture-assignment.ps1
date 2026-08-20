param(
  [Parameter(Mandatory = $true)][string]$Assignee,
  [Parameter(Mandatory = $true)][string]$Assignment,
  [Parameter(Mandatory = $true)][string]$ThreadUrl,
  [Parameter(Mandatory = $true)][string]$AssignedAt,
  [string]$DueDate = "",
  [Parameter(Mandatory = $true)][string]$DedupeKey
)

$ErrorActionPreference = "Stop"
if (-not [Uri]::IsWellFormedUriString($ThreadUrl, [UriKind]::Absolute)) { throw "ThreadUrl must be an absolute URL." }

$projectPath = Split-Path -Parent $PSScriptRoot
Push-Location $projectPath
try {
  $arguments = @(
    "scripts/ledger-cli.mjs", "capture-assignment",
    "--assignee", $Assignee,
    "--assignment", $Assignment,
    "--thread-url", $ThreadUrl,
    "--assigned-at", $AssignedAt,
    "--due-date", $DueDate,
    "--dedupe-key", $DedupeKey
  )
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Could not write the assignment to local storage." }
} finally {
  Pop-Location
}
