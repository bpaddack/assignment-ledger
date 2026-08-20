param(
  [Parameter(Mandatory = $true)][string]$DedupeKey,
  [Parameter(Mandatory = $true)][ValidateSet("true", "false")][string]$Acknowledged,
  [string]$AcknowledgementType = "",
  [string]$AcknowledgementDetail = "",
  [Parameter(Mandatory = $true)][ValidateSet("not_started", "acknowledged", "in_progress", "blocked", "waiting_on_me", "completed")][string]$WorkStatus,
  [Parameter(Mandatory = $true)][string]$Summary,
  [Parameter(Mandatory = $true)][string]$UpdatesJson,
  [string]$LastCheckedAt = ""
)

$ErrorActionPreference = "Stop"
function ConvertTo-SqlText([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }

function Invoke-LocalD1Sql([string]$Sql, [string]$FailureMessage, [string]$PersistTo) {
  $tempPath = Join-Path ([IO.Path]::GetTempPath()) ("assignment-insight-" + [guid]::NewGuid().ToString() + ".sql")
  try {
    [IO.File]::WriteAllText($tempPath, $Sql, [Text.UTF8Encoding]::new($false))
    & npx.cmd wrangler d1 execute site-creator-d1 --local --persist-to $PersistTo --file $tempPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
  } finally {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
  }
}

$projectPath = Split-Path -Parent $PSScriptRoot
$localD1Path = Join-Path $projectPath "data\assignment-ledger"
Push-Location $projectPath
try {
  $schema = "CREATE TABLE IF NOT EXISTS assignment_insights (assignment_id TEXT PRIMARY KEY, acknowledged INTEGER NOT NULL DEFAULT 0, acknowledgement_type TEXT, acknowledgement_detail TEXT, work_status TEXT NOT NULL DEFAULT 'not_started', summary TEXT NOT NULL DEFAULT 'No acknowledgement or progress update yet.', updates_json TEXT NOT NULL DEFAULT '[]', last_checked_at TEXT, updated_at TEXT NOT NULL)"
  Invoke-LocalD1Sql $schema "Could not initialize local assignment insights." $localD1Path

  $ack = if ($Acknowledged -eq "true") { 1 } else { 0 }
  $ackTypeSql = if ($AcknowledgementType) { ConvertTo-SqlText $AcknowledgementType } else { "NULL" }
  $ackDetailSql = if ($AcknowledgementDetail) { ConvertTo-SqlText $AcknowledgementDetail } else { "NULL" }
  $checked = if ($LastCheckedAt) { $LastCheckedAt } else { [DateTimeOffset]::UtcNow.ToString('o') }
  $now = [DateTimeOffset]::UtcNow.ToString('o')
  $sql = "INSERT INTO assignment_insights (assignment_id, acknowledged, acknowledgement_type, acknowledgement_detail, work_status, summary, updates_json, last_checked_at, updated_at) SELECT id, $ack, $ackTypeSql, $ackDetailSql, $(ConvertTo-SqlText $WorkStatus), $(ConvertTo-SqlText $Summary), $(ConvertTo-SqlText $UpdatesJson), $(ConvertTo-SqlText $checked), $(ConvertTo-SqlText $now) FROM assignments WHERE dedupe_key = $(ConvertTo-SqlText $DedupeKey) ON CONFLICT(assignment_id) DO UPDATE SET acknowledged=excluded.acknowledged, acknowledgement_type=excluded.acknowledgement_type, acknowledgement_detail=excluded.acknowledgement_detail, work_status=excluded.work_status, summary=excluded.summary, updates_json=excluded.updates_json, last_checked_at=excluded.last_checked_at, updated_at=excluded.updated_at"
  Invoke-LocalD1Sql $sql "Could not update local assignment insight." $localD1Path
  Write-Output "Updated assignment insight: $DedupeKey — $WorkStatus"
} finally {
  Pop-Location
}
