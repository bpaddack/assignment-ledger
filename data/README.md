# Durable local capture

The authoritative assignment database is stored under `data/assignment-ledger/`. Both the recurring Slack listener and the web app use this exact location. It survives dashboard shutdowns, development-server restarts, and listener interruptions.

`assignment-ledger-backup.sql` is a complete migration snapshot of the database that existed before the explicit data directory was introduced. `assignment-ledger-data.sql` is the data-only migration snapshot used to preserve the existing rows when the new store was initialized. Keep both until the migrated dashboard and listener have been verified.

The recurring Slack listener writes directly to this D1/SQLite store with `scripts/capture-assignment.ps1`. It does not require the web server to be running. The web app reads the same database when it starts.

The optional fast Slack monitor also stores durable per-conversation cursors, its semantic-review queue, and run history in this same database. Its process metadata and append-only diagnostic log live beside the database under `data/assignment-ledger/`; neither depends on the dashboard process.

Stop the dashboard, allow any active listener run to finish, then run `scripts/backup-assignment-ledger.ps1` to create a timestamped copy under `data/backups/`.

## Optional JSONL feed

The running monitor watches `assignment-inbox.jsonl`. Add one JSON object per line:

```json
{"assignee":"Rashmi Nair","assignment":"Prepare the readiness review","threadUrl":"https://example.com/thread/123","assignedAt":"2026-08-18T15:00:00-04:00","dueDate":"2026-08-22","dedupeKey":"thread-123-action-1"}
```

Only the seven configured direct reports are accepted. `dueDate` is optional. `dedupeKey` prevents the same action from being imported more than once.
