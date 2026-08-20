param([Parameter(Mandatory = $true)][string]$MonitorId)

$ErrorActionPreference = "Stop"
$projectPath = Split-Path -Parent $PSScriptRoot
$localD1Path = Join-Path $projectPath "data\assignment-ledger"
function ConvertTo-SqlText([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }

Push-Location $projectPath
try {
  & npx.cmd wrangler d1 execute site-creator-d1 --local --persist-to $localD1Path --command "CREATE TABLE IF NOT EXISTS monitor_state (monitor_id TEXT PRIMARY KEY, last_successful_ts TEXT NOT NULL, last_successful_at TEXT NOT NULL, updated_at TEXT NOT NULL)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not initialize the durable monitor checkpoint." }
  $raw = & npx.cmd wrangler d1 execute site-creator-d1 --local --persist-to $localD1Path --json --command "SELECT monitor_id, last_successful_ts, last_successful_at FROM monitor_state WHERE monitor_id = $(ConvertTo-SqlText $MonitorId)"
  if ($LASTEXITCODE -ne 0) { throw "Could not read the durable monitor checkpoint." }
  $payload = $raw | ConvertFrom-Json
  $row = $payload[0].results[0]
  if ($null -eq $row) {
    [pscustomobject]@{ monitorId = $MonitorId; lastSuccessfulTs = ""; lastSuccessfulAt = "" } | ConvertTo-Json -Compress
  } else {
    [pscustomobject]@{ monitorId = $row.monitor_id; lastSuccessfulTs = $row.last_successful_ts; lastSuccessfulAt = $row.last_successful_at } | ConvertTo-Json -Compress
  }
} finally { Pop-Location }
