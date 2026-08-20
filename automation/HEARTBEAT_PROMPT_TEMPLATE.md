# Heartbeat prompt template

Replace every `<PLACEHOLDER>` during setup. Do not leave this template unpersonalized in an active automation.

```text
Every run, monitor two independent Slack ledgers for <MANAGER_NAME> (<MANAGER_SLACK_ID>, @<MANAGER_HANDLE>) in <SLACK_WORKSPACE_HOST> across all accessible public channels, private channels, group messages, and DMs. The exact tracked assignees are: <ASSIGNEE_NAME_AND_ID_LIST>. The project root is <ABSOLUTE_PROJECT_PATH>. The authoritative local database is <ABSOLUTE_PROJECT_PATH>/data/assignment-ledger. Never POST to localhost or depend on the dashboard running.

GENERAL CHECKPOINT RULE: For each ledger, run `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs get-checkpoint --monitor-id <MONITOR_ID>` and parse its JSON. Record the run-start Slack timestamp and UTC ISO time as the ceiling. Search from at least <BACKFILL_DAYS> calendar day(s) before the saved time and intentionally reprocess the overlap; database dedupe makes this safe. Process candidates only through the ceiling. Never advance a ledger checkpoint if any search page, conversation/thread/context review, capture, database query, or insight write for that ledger fails. Only after the ledger fully succeeds run `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs update-checkpoint --monitor-id <MONITOR_ID> --last-successful-ts <RUN_START_SLACK_TS> --last-successful-at <RUN_START_UTC_ISO>`. Never use heartbeat memory as the authoritative cursor.

DUE-DATE RULE: Resolve relative date language from the Slack source message's own timestamp in the configured manager timezone, never from the heartbeat run time or UTC date boundary. For example, if a message sent on August 18 in the manager's local timezone says "tomorrow," persist August 19. Store date-only due dates as `YYYY-MM-DD` without converting them to UTC. Use thread/context discussion to refine the date, but never shift an explicit or implied local calendar date by timezone conversion.

FAST-LANE REVIEW QUEUE: The dashboard-independent five-minute listener captures only high-confidence items and queues ambiguous candidates. At the start of this heartbeat run, execute `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs list-pending-candidates --limit 500`. For each candidate, inspect the complete source/thread and sufficient surrounding context under the applicable ledger rules below. If it qualifies, capture it with the normal ledger command and then execute `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs resolve-monitor-candidate --dedupe-key <DEDUPE_KEY> --status captured`. If it does not qualify, resolve it with `--status ignored`. Never resolve a candidate when its required Slack context could not be reviewed. Database dedupe makes overlap with normal searches safe.

LEDGER 1 — DELEGATED ASSIGNMENTS (`delegated_assignments_slack`): Search workspace-wide for messages authored by <MANAGER_NAME>, paginate all pages, enumerate relevant DMs, and inspect complete threads plus enough surrounding context to resolve indirect references. Capture only direct tasks/actions assigned by <MANAGER_NAME> to one of the exact configured assignees. Resolve identity using verified Slack IDs, not names alone. Never capture work for another person or another author's request. Persist each record with `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs capture-assignment --assignee <CANONICAL_NAME> --assignment <CONCISE_OUTCOME> --thread-url <PERMALINK> --assigned-at <ISO_TIME> --due-date <DATE_OR_EMPTY> --dedupe-key slack-<CHANNEL>-<MESSAGE_TS>`. Append an assignee ID only for a genuine multi-assignee message.

For every incomplete delegated record, review the source, full thread, reactions with user metadata, and relevant nearby later messages. Only evidence authored by that assignment's assignee counts. Status is exactly not_started, acknowledged, in_progress, blocked, waiting_on_me, or completed. Do not infer progress. Preserve chronological assignee-only evidence and write it with `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs update-assignment-insight` using --dedupe-key, --acknowledged true/false, --acknowledgement-type, --acknowledgement-detail, --work-status, --summary, --updates-json, and --last-checked-at.

<INBOUND_LEDGER_SECTION>

For unavailable or deleted Slack sources, retain prior evidence and note the source is unavailable. Run every enabled ledger even when no new candidates are found. Stay silent when nothing changes and report only errors requiring user action.
```

When inbound capture is enabled, replace `<INBOUND_LEDGER_SECTION>` with:

```text
LEDGER 2 — MY TASKS AND ASSIGNMENTS (`my_tasks_slack`): Paginate workspace searches for direct <@MANAGER_SLACK_ID>/@<MANAGER_HANDLE> mentions and exact manager-name references. Enumerate every accessible 1:1 DM and fetch history from the overlap because DM requests may omit a name. Ignore messages authored by the manager. Inspect full threads and surrounding context.

In channels/group DMs, capture only when the manager is directly mentioned, is the unambiguous addressee of a reply, or context unambiguously assigns the request to the manager, AND the content contains a concrete action, direct question needing an answer, request for input/approval/review/decision, or explicit ownership/follow-up. In 1:1 DMs a mention is unnecessary, but a concrete actionable request/question is still required. Exclude FYIs, greetings, praise, informational statements, rhetorical questions, casual conversation, broad group requests without manager ownership, and non-actionable mentions.

Persist requester, concise outcome/question, type exactly task/question/input/approval/review, permalink, asked time, and discussed due date with `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs capture-my-task --requester <NAME> --request-type <TYPE> --task <OUTCOME> --thread-url <PERMALINK> --asked-at <ISO_TIME> --due-date <DATE_OR_EMPTY> --dedupe-key slack-inbound-<CHANNEL>-<MESSAGE_TS>`.

For every incomplete inbound record, review the complete source/thread, reactions with user metadata, and relevant surrounding messages. Only the manager's own reply or emoji reaction counts as acknowledgement/progress. Status is exactly not_started, acknowledged, in_progress, blocked, waiting_on_requester, or completed. A substantive answer or delivered input/review/decision counts as completed. Preserve chronological manager-only evidence and write it with `node <ABSOLUTE_PROJECT_PATH>/scripts/ledger-cli.mjs update-my-task-insight` using the same insight flags.
```
