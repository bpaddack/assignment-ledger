param(
  [Parameter(Mandatory = $true)][string]$Requester,
  [Parameter(Mandatory = $true)][ValidateSet("task", "question", "input", "approval", "review")][string]$RequestType,
  [Parameter(Mandatory = $true)][string]$Task,
  [Parameter(Mandatory = $true)][string]$ThreadUrl,
  [Parameter(Mandatory = $true)][string]$AskedAt,
  [string]$DueDate = "",
  [Parameter(Mandatory = $true)][string]$DedupeKey
)

$ErrorActionPreference = "Stop"
if (-not [Uri]::IsWellFormedUriString($ThreadUrl, [UriKind]::Absolute)) { throw "ThreadUrl must be an absolute URL." }
$cli = Join-Path $PSScriptRoot "ledger-cli.mjs"
$arguments = @($cli, "capture-my-task", "--requester", $Requester, "--request-type", $RequestType, "--task", $Task, "--thread-url", $ThreadUrl, "--asked-at", $AskedAt)
if ($DueDate) { $arguments += @("--due-date", $DueDate) }
$arguments += @("--dedupe-key", $DedupeKey)
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Could not write the task to local storage." }
