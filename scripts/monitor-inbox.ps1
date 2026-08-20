param(
  [string]$InboxPath = "$PSScriptRoot\..\data\assignment-inbox.jsonl",
  [string]$Endpoint = "http://localhost:3000/api/assignments"
)

$projectPath = Split-Path -Parent $PSScriptRoot
$tracker = Get-Content -Raw (Join-Path $projectPath "config\tracker.json") | ConvertFrom-Json
$allowed = @($tracker.assignees | ForEach-Object { $_.name })
Write-Output "Monitoring $InboxPath for direct-report assignments."

Get-Content -LiteralPath $InboxPath -Tail 0 -Wait | ForEach-Object {
  $line = $_.Trim()
  if (-not $line) { return }
  try {
    $event = $line | ConvertFrom-Json
    if ($allowed -notcontains $event.assignee) {
      Write-Warning "Ignored assignment for non-monitored person: $($event.assignee)"
      return
    }
    if (-not $event.dedupeKey) { $event | Add-Member -NotePropertyName dedupeKey -NotePropertyValue ([guid]::NewGuid().ToString()) }
    $event | Add-Member -NotePropertyName source -NotePropertyValue "monitor" -Force
    $json = $event | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $Endpoint -Method Post -ContentType "application/json" -Body $json | Out-Null
    Write-Output "Captured assignment for $($event.assignee)."
  } catch {
    Write-Warning "Could not capture inbox line: $($_.Exception.Message)"
  }
}
