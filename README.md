# Assignment Ledger

A local, two-ledger productivity app that monitors Slack for:

- work you delegate to a configured list of people; and
- actionable requests, questions, reviews, approvals, and decisions directed to you.

The dashboard, fast listener, and recurring Codex reconciliation share a durable local D1/SQLite database. Captures do not depend on the dashboard being open and are never posted to localhost.

## Highlights

- Two-minute high-confidence Slack listener with durable cursors and overlap
- Comprehensive recurring Codex reconciliation for context and progress evidence
- Separate delegated-work and inbound-request ledgers
- Evidence-based acknowledgement and progress states
- Due dates resolved in the configured user's local timezone
- Desktop notifications for newly captured inbound requests only
- Daily completed tally, view-aware requester filters, archive/reopen controls
- Direct Slack source links
- Friendly local address at [http://tasks.localhost](http://tasks.localhost)

## Privacy model

The repository contains application source and an unconfigured template. Each installation keeps the following data local and out of Git:

- `config/tracker.json` — personal Slack identities and workspace settings
- `data/assignment-ledger/` — captured tasks, evidence, checkpoints, and preferences
- `data/backups/` and SQL snapshots
- local logs, build output, and dependencies

Do not commit those files. The included `.gitignore` protects them by default.

## Install with Codex

1. Clone or download this repository into a permanent folder.
2. Open that folder as a project in Codex.
3. Ask Codex: **Configure this Assignment Ledger for me.**
4. Codex will follow [SETUP_WITH_CODEX.md](SETUP_WITH_CODEX.md), confirm every Slack identity, install dependencies, configure monitoring, verify the app, and launch it.

The setup interview intentionally does not guess Slack identities from names.

## Manual development setup

Requirements:

- Node.js 22.13 or newer
- npm
- Codex with an authenticated Slack connection for monitoring

Create a local configuration before running the app:

```powershell
Copy-Item config/tracker.package.json config/tracker.json
```

Populate `config/tracker.json`, then run:

```powershell
npm install
npm run lint
npm test
npm run launch
```

`npm run launch` starts the dashboard and fast listener without leaving a visible terminal window, then opens `http://tasks.localhost` in the default browser.

The launcher reuses a healthy instance and removes stale project-owned processes before starting. Use `npm run app:status`, `npm run app:restart`, or `npm run app:stop` to manage the complete local app without leaving orphaned dashboard, proxy, or listener processes.

## Useful commands

```powershell
npm run dev
npm run build
npm test
npm run monitor:fast:status
npm run monitor:fast:probe
npm run monitor:fast:once
npm run monitor:fast:start
npm run monitor:fast:stop
```

The legacy PowerShell helpers remain available, but listener database writes are implemented by the cross-platform `node scripts/ledger-cli.mjs` interface.

## Project layout

| Path | Purpose |
| --- | --- |
| `app/` | Dashboard and local API routes |
| `automation/` | Portable comprehensive-listener prompt template |
| `config/tracker.package.json` | Unconfigured installation template |
| `db/` and `drizzle/` | D1 schema and migrations |
| `scripts/ledger-cli.mjs` | Cross-platform local database write interface |
| `scripts/slack-fast-monitor.mjs` | Two-minute high-confidence listener |
| `scripts/manage-fast-monitor.mjs` | Hidden background listener lifecycle |
| `scripts/launch-dashboard.mjs` | Quiet dashboard/listener launcher |
| `SETUP_WITH_CODEX.md` | Authoritative installation procedure |
| `tests/` | Build and listener behavior verification |

## Updating an installation

Local configuration and ledger data are ignored, so normal source updates do not overwrite them:

```powershell
git pull --ff-only
npm install
npm test
npm run launch
```

For this repository, changes should be committed to GitHub after tests pass. Use pull requests for larger or risky changes; small verified maintenance changes may be committed directly to `main`.

## Releases

The application version is stored in `package.json`. User-facing changes are recorded in [CHANGELOG.md](CHANGELOG.md). Stable installation points are tagged as `vMAJOR.MINOR.PATCH` releases.

## Local data and backups

The authoritative ledger is under `data/assignment-ledger/`. Create a timestamped backup with:

```powershell
.\scripts\backup-assignment-ledger.ps1
```

Backups contain Slack-derived business information and are intentionally excluded from Git.

## Troubleshooting

- If Slack tools are missing, run `ghost mcp all`, restart Codex, and retry setup.
- If the dashboard says it is starting, check `npm run monitor:fast:status` and rerun `npm run launch`.
- If `tasks.localhost` does not resolve, run `npm run configure:hostname` with administrator approval.
- If no tasks appear, verify the Slack connection, `config/tracker.json`, and the local D1 path before changing the UI.

See [DISTRIBUTION_README.md](DISTRIBUTION_README.md) for the portable package overview and [SETUP_WITH_CODEX.md](SETUP_WITH_CODEX.md) for the complete setup procedure.
