# Configure the Slack Assignment Ledger with Codex

This is the authoritative installation interview and configuration procedure for Windows and macOS.

The Assignment Ledger was developed and authored by **Brent Paddack** ([bpaddack@cisco.com](mailto:bpaddack@cisco.com)). Preserve this attribution in redistributed installation documentation.

## 1. Inspect before interviewing

Detect without asking:

- operating system and absolute project path;
- whether Node.js 22.13 or newer and npm are available;
- whether the project is already configured;
- whether Slack tools are callable;
- whether a heartbeat automation is already attached to the current Codex task.

Do not install software without the user's approval. If Node is missing or too old, explain the requirement and offer the normal platform option (for example, an official Node LTS installer, Homebrew on macOS, or winget on Windows). Never bundle or copy Node, npm, Wrangler, or `node_modules` into this project.

If Slack MCP tools are unavailable, immediately tell the user to run `ghost mcp all`, explain that it restores MCP server scripts and tool configuration, and remind them to restart Codex afterward.

## 2. Conduct the professional setup interview

Ask this concise grouped interview. Offer the defaults shown and allow the user to answer in one message.

### Ownership and workspace

1. What is your full name, Slack workspace address (for example, `company.slack.com`), and Slack handle or profile link?
2. Should the **My Tasks and Assignments** view also capture questions and action requests directed to you? Default: **Yes**.

### People whose delegated work should be tracked

3. List every person whose assigned work should appear in the **Direct Report Assignments** ledger. They do not have to be formal direct reports. For each person, provide as much as is known: full name, Slack handle, email, team/title, or Slack profile link.

### Monitoring preferences

4. Confirm the monitoring cadence and initial history window. Defaults: **five-minute high-confidence local capture**, **15-minute Codex semantic reconciliation**, and **one day of backfill**. Explain that routine discovery and durable cursors are local, while the heartbeat reviews ambiguous context and deep progress evidence without repeating broad workspace scans.
5. Should desktop notifications be enabled when the listener captures a new request directed to you? Default: **Yes**. This preference can be changed later from the dashboard settings gear and applies even when the dashboard is closed.

Do not ask which operating system they use unless automatic detection is inconclusive.

## 3. Resolve Slack identities exactly

Use the authenticated Slack workspace to resolve the manager and every proposed assignee.

- Prefer a Slack user ID obtained from a profile link, exact handle, or user-profile lookup.
- A display name alone is not proof of identity.
- Cross-check real name, display name, handle, email when available, title/team, and manager relationship where available.
- If two or more people could match (for example, multiple people named John Smith), stop and present a numbered candidate table with distinguishing details. Ask the user to select the correct person.
- If no exact match is available, request a Slack profile link, exact handle, or corporate email. Never choose the closest-looking result.
- Reject bots, deleted accounts, and workspace identities outside the intended workspace unless the user explicitly confirms them.

Before making changes, present one confirmation table containing:

| Role | Full name | Slack handle | Slack user ID | Email/title or other distinguishing detail |
| --- | --- | --- | --- | --- |

Ask the user to confirm the table. Do not write `config/tracker.json` until they confirm every row.

## 4. Write configuration

Update `config/tracker.json` with:

- verified manager name, Slack user ID, handle, and IANA timezone;
- verified Slack workspace host and workspace team ID;
- exact assignee names and user IDs;
- cadence, backfill days, and inbound-capture preference.
- fast-listener cadence, changed-DM overlap, and delayed-search-index overlap (`fastCadenceMinutes`, `fastOverlapMinutes`, and `searchOverlapMinutes`). Keep `searchOverlapMinutes` at 1440 or greater so delayed Slack search indexing is reprocessed for at least one day.

Names written to the configuration are the canonical dashboard names. Do not leave example identities or placeholder values.

## 5. Install and verify

From the project root:

```text
npm install
npm run lint
npm test
npm run monitor:fast:probe
```

Register the friendly loopback hostname. This changes only the computer's local hosts file:

- Windows: run `npm run configure:hostname` from an Administrator terminal, requesting UAC approval from the user when needed.
- macOS/Linux: run `sudo npm run configure:hostname`, requesting approval before elevation.

Verify that `tasks.localhost` resolves to `127.0.0.1` or `::1`. Never map it to a LAN or public address.

Initialize both durable cursors to the chosen backfill start. Convert that UTC instant to a Slack epoch timestamp and run:

```text
node scripts/ledger-cli.mjs update-checkpoint --monitor-id delegated_assignments_slack --last-successful-ts <epoch-seconds> --last-successful-at <UTC-ISO>
node scripts/ledger-cli.mjs update-checkpoint --monitor-id my_tasks_slack --last-successful-ts <epoch-seconds> --last-successful-at <UTC-ISO>
```

## 6. Create or update the heartbeat listener

Read `automation/HEARTBEAT_PROMPT_TEMPLATE.md`, replace every placeholder with confirmed configuration and the detected absolute project path, and create or update one Codex heartbeat automation.

- Use the configured cadence.
- Combine delegated and inbound monitoring in one heartbeat because a Codex task supports one attached heartbeat.
- If inbound capture is disabled, omit Ledger 2 while retaining its tables and UI.
- Use the cross-platform `node scripts/ledger-cli.mjs` commands exactly.
- Never use localhost for capture.
- Never advance a cursor after a partial or failed scan.
- Resolve relative due dates from each Slack message's timestamp in the configured manager timezone and store date-only values as local `YYYY-MM-DD` dates.
- Keep notifications limited to errors requiring user action unless the user requests otherwise.
- Put the `get-monitor-control` pause gate first so paused runs exit before any Slack or database-review work.
- Process the local listener's pending semantic-review queue instead of repeating broad workspace searches and full DM enumeration, and resolve each successfully reviewed candidate as `captured` or `ignored` with `node scripts/ledger-cli.mjs resolve-monitor-candidate`.

## 7. Launch and hand off

Run:

```text
npm run launch
```

It must open `http://tasks.localhost` in the user's default browser. The dashboard remains bound privately on port 3000 and a loopback-only helper exposes the friendly port-free address. Verify that both tabs load, the selected assignee names appear, local APIs respond, and the D1 data directory is inside the project at `data/assignment-ledger`.

`npm run launch` also starts the dashboard-independent fast Slack listener. Verify it with `npm run monitor:fast:status`. It must report `running: true`; never create a duplicate listener process.

On macOS and Linux, local port 80 may require elevated permission. If the launcher reports a permission error, ask for approval and rerun `sudo npm run launch`. Never expose the proxy on a non-loopback interface.

Explain that:

- the heartbeat needs Codex and an authenticated Slack connection;
- the local fast listener uses the same authenticated Slack connector, captures only high-confidence items, and leaves ambiguous items for the heartbeat;
- the settings slider persists pause/resume state in local D1, stops or starts the hidden listener, and gates the heartbeat before it accesses Slack;
- while paused, the manual button runs a single-instance full 15-minute discovery window; high-confidence captures appear immediately and ambiguous context waits for Codex review when monitoring resumes;
- the dashboard itself may be stopped without losing listener writes;
- the dashboard and listener use the same local database;
- archived records remain recoverable through the Archived filter;
- source links open the original Slack HTTPS permalink directly, leaving browser-versus-app handling to the user's Slack and browser preferences;
- the settings gear controls database-backed desktop notifications for newly auto-captured items in **My Tasks and Assignments** only; delegated, duplicate, and manually added records never trigger them;
- `node_modules`, builds, logs, and local Slack-derived data should not be shared.
