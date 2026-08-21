# Changelog

All notable user-facing changes to Assignment Ledger are recorded here.

The project follows semantic versioning for tagged releases.

## Unreleased

### Added

- Persisted heartbeat-monitor pause/resume slider and manual full 15-minute fetch button.
- Single-instance hidden manual-fetch process management and a first-step pause gate for scheduled Codex runs.

### Changed

- Moved routine Slack discovery to the lightweight local listener and made Codex reconciliation queue-first to reduce UI latency and token use.
- Changed the dashboard-independent fast Slack listener cadence from two minutes to five minutes.
- Improved hidden process lifecycle management so app restarts clean up stale project-owned dashboard, proxy, and listener processes.
- Added developer and author attribution for Brent Paddack to the installation documentation and package metadata.
- Excluded automated Jira app notifications from inbound tasks and stopped URL query-string punctuation from being interpreted as a human question.

## [0.2.0] - 2026-08-19

### Added

- Separate inbound **My Tasks and Assignments** ledger
- Two-minute dashboard-independent fast Slack listener
- Durable Slack checkpoints, overlap, candidate queue, and local D1 persistence
- Windows and macOS desktop notifications for newly captured inbound requests
- Settings gear with a shared notification preference
- Friendly `tasks.localhost` launcher and hidden background services
- Daily completed tally and view-aware requester filters

### Changed

- Slack source actions now open the original HTTPS permalink directly
- Relative due dates resolve from the source message timestamp in the configured timezone
- Listener writes use the cross-platform `scripts/ledger-cli.mjs` interface

### Packaging

- Added portable Codex-led setup instructions
- Excluded personal configuration, Slack-derived data, logs, and generated files from Git
- Added automated lint, build, and behavior checks for GitHub changes
