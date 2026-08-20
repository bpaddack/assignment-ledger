param(
  [Parameter(Mandatory = $true)][string]$MonitorId,
  [Parameter(Mandatory = $true)][string]$LastSuccessfulTs,
  [Parameter(Mandatory = $true)][string]$LastSuccessfulAt
)

$ErrorActionPreference = "Stop"
function ConvertTo-SqlText([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$projectPath = Split-Path -Parent $PSScriptRoot
$localD1Path = Join-Path $projectPath "data\assignment-ledger"
$now = [DateTimeOffset]::UtcNow.ToString("o")
$sql = "CREATE TABLE IF NOT EXISTS monitor_state (monitor_id TEXT PRIMARY KEY, last_successful_ts TEXT NOT NULL, last_successful_at TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO monitor_state (monitor_id, last_successful_ts, last_successful_at, updated_at) VALUES ($(ConvertTo-SqlText $MonitorId), $(ConvertTo-SqlText $LastSuccessfulTs), $(ConvertTo-SqlText $LastSuccessfulAt), $(ConvertTo-SqlText $now)) ON CONFLICT(monitor_id) DO UPDATE SET last_successful_ts=excluded.last_successful_ts, last_successful_at=excluded.last_successful_at, updated_at=excluded.updated_at;"

Push-Location $projectPath
try {
  & npx.cmd wrangler d1 execute site-creator-d1 --local --persist-to $localD1Path --command $sql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not update the durable monitor checkpoint." }
  Write-Output "Checkpoint updated: $MonitorId — $LastSuccessfulAt"
} finally { Pop-Location }
