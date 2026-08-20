# Slack Assignment Ledger — Portable Package

Developed and authored by **Brent Paddack** ([bpaddack@cisco.com](mailto:bpaddack@cisco.com)).

This source package recreates the local two-ledger productivity tool:

- **Direct Report Assignments** tracks work delegated to a verified list of people.
- **My Tasks and Assignments** tracks actionable Slack questions and requests directed to the manager.

It includes the original dashboard design and behavior, durable local D1/SQLite storage, acknowledgement and progress timelines, due dates, manual completion, archive/unarchive controls, Slack permalinks, database-backed scan checkpoints, a five-minute dashboard-independent fast listener, the 15-minute comprehensive reconciliation prompt, and discreet desktop notifications for new requests directed to the user.

Source controls open the original Slack HTTPS permalink directly; the user's browser and Slack preferences decide whether that link stays in the browser or opens in Slack. Completed summary totals cover the current local calendar day and reset at midnight. Requester filters are scoped to the records present in the selected status view.

The settings gear controls **Desktop notifications** for the local installation. Notifications are on by default, use Windows Notification Center or macOS Notification Center, work even when the dashboard is closed, appear only for newly auto-captured items in **My Tasks and Assignments**, and never appear for work delegated to other people or records added manually. The setting is stored in the local ledger so the background listener and dashboard share the same preference. The in-page popup remains available when the dashboard is open.

## Start here

1. Extract the ZIP into a permanent folder on Windows or macOS.
2. Open Codex and create/open a project using that extracted folder.
3. Ask Codex: **“Configure this Assignment Ledger for me.”**
4. Codex will interview you, resolve and confirm the exact Slack identities, install retrieved dependencies, create the heartbeat listener, verify the application, and open it in your default browser.

Do not enter partial Slack names and accept a guessed match. The setup procedure requires a confirmation table for every identity, including distinguishing information when names are duplicated.

## Requirements retrieved during setup

The ZIP intentionally excludes third-party and generated content. Setup retrieves:

- Node.js 22.13 or newer when it is not already available;
- npm dependencies declared in `package.json`;
- the local Wrangler runtime used by D1;
- no sample or prior user's Slack data.

An authenticated Slack connector in Codex/Ghost is required for monitoring. The local dashboard itself can be closed without stopping the fast listener or direct database capture. The fast listener records only high-confidence items and queues ambiguous context for the recurring Codex reconciliation.

## Local privacy

All captured task records, context, completion state, archive state, monitor checkpoints, fast-listener cursors/review queue, and desktop-notification preference are stored under `data/assignment-ledger` inside the extracted project. The in-page popup watermark is stored in that browser's local storage. The data directory is created locally and was not included in this ZIP.

Do not redistribute the configured project without first excluding `data`, `node_modules`, build folders, logs, and personalized `config/tracker.json` if identities should remain private.

## Platform support

The app and listener use Node.js and run on Windows and macOS. During setup, Codex registers `tasks.localhost` as a loopback-only hostname. `npm run launch` detects the platform, starts the dashboard and fast listener, and opens `http://tasks.localhost` in the default browser. Updating the local hosts file—and, on macOS/Linux, using local port 80—may request administrator approval.

Detailed Codex instructions are in `AGENTS.md` and `SETUP_WITH_CODEX.md`. The listener prompt is in `automation/HEARTBEAT_PROMPT_TEMPLATE.md`.
