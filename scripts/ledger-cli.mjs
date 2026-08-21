#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const persistPath = join(projectPath, "data", "assignment-ledger");
const config = JSON.parse(readFileSync(join(projectPath, "config", "tracker.json"), "utf8"));
const wranglerCli = join(projectPath, "node_modules", "wrangler", "wrangler-dist", "cli.js");

function parseArgs(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) { parsed._.push(value); continue; }
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith("--") ? values[++index] : "true";
  }
  return parsed;
}

function required(args, names) {
  for (const name of names) if (args[name] === undefined || args[name] === "") throw new Error(`Missing --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
}

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const nullable = (value) => value ? sqlText(value) : "NULL";

function executeFile(sql) {
  const temporary = mkdtempSync(join(tmpdir(), "assignment-ledger-"));
  const sqlPath = join(temporary, "operation.sql");
  try {
    writeFileSync(sqlPath, sql, "utf8");
    const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "site-creator-d1", "--local", "--persist-to", persistPath, "--file", sqlPath], { cwd: projectPath, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Local database command failed.");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function query(sql) {
  const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "site-creator-d1", "--local", "--persist-to", persistPath, "--json", "--command", sql], { cwd: projectPath, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Local database query failed.");
  return JSON.parse(result.stdout)?.[0]?.results ?? [];
}

const assignmentSchema = `CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, assignee TEXT NOT NULL, assignment TEXT NOT NULL, thread_url TEXT NOT NULL, assigned_at TEXT NOT NULL, due_date TEXT, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, source TEXT NOT NULL DEFAULT 'manual', dedupe_key TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_dedupe_key ON assignments(dedupe_key) WHERE dedupe_key IS NOT NULL;`;
const taskSchema = `CREATE TABLE IF NOT EXISTS my_tasks (id TEXT PRIMARY KEY, requester TEXT NOT NULL, request_type TEXT NOT NULL DEFAULT 'task', task TEXT NOT NULL, thread_url TEXT NOT NULL, asked_at TEXT NOT NULL, due_date TEXT, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, source TEXT NOT NULL DEFAULT 'manual', dedupe_key TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_my_tasks_dedupe_key ON my_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL;`;
const assignmentInsightSchema = "CREATE TABLE IF NOT EXISTS assignment_insights (assignment_id TEXT PRIMARY KEY, acknowledged INTEGER NOT NULL DEFAULT 0, acknowledgement_type TEXT, acknowledgement_detail TEXT, work_status TEXT NOT NULL DEFAULT 'not_started', summary TEXT NOT NULL DEFAULT 'No acknowledgement or progress update yet.', updates_json TEXT NOT NULL DEFAULT '[]', last_checked_at TEXT, updated_at TEXT NOT NULL);";
const taskInsightSchema = "CREATE TABLE IF NOT EXISTS my_task_insights (my_task_id TEXT PRIMARY KEY, acknowledged INTEGER NOT NULL DEFAULT 0, acknowledgement_type TEXT, acknowledgement_detail TEXT, work_status TEXT NOT NULL DEFAULT 'not_started', summary TEXT NOT NULL DEFAULT 'No response or progress update from you yet.', updates_json TEXT NOT NULL DEFAULT '[]', last_checked_at TEXT, updated_at TEXT NOT NULL);";
const checkpointSchema = "CREATE TABLE IF NOT EXISTS monitor_state (monitor_id TEXT PRIMARY KEY, last_successful_ts TEXT NOT NULL, last_successful_at TEXT NOT NULL, updated_at TEXT NOT NULL);";
const settingsSchema = "CREATE TABLE IF NOT EXISTS app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT NOT NULL);";
const fastMonitorSchema = `CREATE TABLE IF NOT EXISTS monitor_cursors (monitor_id TEXT NOT NULL, cursor_key TEXT NOT NULL, last_seen_ts TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (monitor_id,cursor_key));
CREATE TABLE IF NOT EXISTS monitor_candidates (dedupe_key TEXT PRIMARY KEY, ledger TEXT NOT NULL, channel_id TEXT NOT NULL, message_ts TEXT NOT NULL, author_id TEXT, target_id TEXT, text TEXT NOT NULL, thread_url TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', detected_at TEXT NOT NULL, processed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_monitor_candidates_pending ON monitor_candidates(ledger,message_ts) WHERE status='pending';
CREATE TABLE IF NOT EXISTS monitor_runs (run_id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, ceiling_ts TEXT NOT NULL, conversations_checked INTEGER NOT NULL DEFAULT 0, messages_checked INTEGER NOT NULL DEFAULT 0, captured_count INTEGER NOT NULL DEFAULT 0, candidate_count INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_monitor_finished ON monitor_runs(monitor_id,finished_at);`;

function desktopNotificationsEnabled() {
  executeFile(settingsSchema);
  const row = query("SELECT setting_value FROM app_settings WHERE setting_key='desktop_notifications_enabled'")[0];
  return row?.setting_value !== "false";
}

function monitorEnabled() {
  executeFile(settingsSchema);
  const row = query("SELECT setting_value FROM app_settings WHERE setting_key='heartbeat_monitor_enabled'")[0];
  return row?.setting_value !== "false";
}

function getMonitorControl() {
  executeFile(`${settingsSchema}\n${fastMonitorSchema}`);
  const lastRun = query("SELECT started_at,finished_at,outcome,captured_count,candidate_count FROM monitor_runs WHERE monitor_id='slack_fast_lane' ORDER BY finished_at DESC LIMIT 1")[0];
  console.log(JSON.stringify({
    enabled: monitorEnabled(),
    lastRun: lastRun ? {
      startedAt: lastRun.started_at,
      finishedAt: lastRun.finished_at,
      outcome: lastRun.outcome,
      capturedCount: Number(lastRun.captured_count) || 0,
      candidateCount: Number(lastRun.candidate_count) || 0,
    } : null,
  }));
}

function setMonitorControl(args) {
  required(args, ["enabled"]);
  if (!["true", "false"].includes(args.enabled)) throw new Error("enabled must be true or false.");
  executeFile(`${settingsSchema}\nINSERT INTO app_settings (setting_key,setting_value,updated_at) VALUES ('heartbeat_monitor_enabled',${sqlText(args.enabled)},${sqlText(new Date().toISOString())}) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at;`);
  console.log(JSON.stringify({ enabled: args.enabled === "true" }));
}

function showDesktopNotification(requester, task) {
  const title = `New task from ${requester}`;
  const body = task.length > 220 ? `${task.slice(0, 217)}…` : task;
  if (process.platform === "win32") {
    const ps = `$title = $env:ASSIGNMENT_LEDGER_NOTIFICATION_TITLE\n$body = $env:ASSIGNMENT_LEDGER_NOTIFICATION_BODY\n[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null\n$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02\n$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)\n$null = $xml.GetElementsByTagName('text').Item(0).AppendChild($xml.CreateTextNode($title))\n$null = $xml.GetElementsByTagName('text').Item(1).AppendChild($xml.CreateTextNode($body))\n$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)\n[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Slack Assignment Ledger').Show($toast)`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, env: { ...process.env, ASSIGNMENT_LEDGER_NOTIFICATION_TITLE: title, ASSIGNMENT_LEDGER_NOTIFICATION_BODY: body } });
    if (result.status !== 0) console.error(`Desktop notification failed: ${result.stderr || result.stdout}`);
  } else if (process.platform === "darwin") {
    const script = "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run";
    const result = spawnSync("osascript", ["-e", script, "--", title, body], { encoding: "utf8" });
    if (result.status !== 0) console.error(`Desktop notification failed: ${result.stderr || result.stdout}`);
  }
}

function captureAssignment(args) {
  required(args, ["assignee", "assignment", "threadUrl", "assignedAt", "dedupeKey"]);
  if (!config.assignees.some((person) => person.name === args.assignee)) throw new Error("Assignee is not in config/tracker.json.");
  executeFile(`${assignmentSchema}\nINSERT OR IGNORE INTO assignments (id,assignee,assignment,thread_url,assigned_at,due_date,completed,archived,source,dedupe_key,created_at) VALUES (${sqlText(crypto.randomUUID())},${sqlText(args.assignee)},${sqlText(args.assignment)},${sqlText(args.threadUrl)},${sqlText(args.assignedAt)},${nullable(args.dueDate)},0,0,'monitor',${sqlText(args.dedupeKey)},${sqlText(new Date().toISOString())});`);
  console.log(`Captured locally: ${args.assignee} — ${args.assignment}`);
}

function captureMyTask(args) {
  required(args, ["requester", "requestType", "task", "threadUrl", "askedAt", "dedupeKey"]);
  if (!["task", "question", "input", "approval", "review"].includes(args.requestType)) throw new Error("Invalid request type.");
  executeFile(taskSchema);
  const alreadyCaptured = query(`SELECT 1 AS found FROM my_tasks WHERE dedupe_key=${sqlText(args.dedupeKey)} LIMIT 1`)[0]?.found === 1;
  executeFile(`${taskSchema}\nINSERT OR IGNORE INTO my_tasks (id,requester,request_type,task,thread_url,asked_at,due_date,completed,archived,source,dedupe_key,created_at) VALUES (${sqlText(crypto.randomUUID())},${sqlText(args.requester)},${sqlText(args.requestType)},${sqlText(args.task)},${sqlText(args.threadUrl)},${sqlText(args.askedAt)},${nullable(args.dueDate)},0,0,'monitor',${sqlText(args.dedupeKey)},${sqlText(new Date().toISOString())});`);
  console.log(`Captured locally: ${args.requester} — ${args.task}`);
  if (!alreadyCaptured && desktopNotificationsEnabled()) showDesktopNotification(args.requester, args.task);
}

function updateInsight(args, inbound) {
  required(args, ["dedupeKey", "acknowledged", "workStatus", "summary", "updatesJson"]);
  JSON.parse(args.updatesJson);
  const valid = inbound ? ["not_started", "acknowledged", "in_progress", "blocked", "waiting_on_requester", "completed"] : ["not_started", "acknowledged", "in_progress", "blocked", "waiting_on_me", "completed"];
  if (!valid.includes(args.workStatus)) throw new Error("Invalid work status.");
  const table = inbound ? "my_task_insights" : "assignment_insights";
  const idColumn = inbound ? "my_task_id" : "assignment_id";
  const sourceTable = inbound ? "my_tasks" : "assignments";
  const schema = inbound ? taskInsightSchema : assignmentInsightSchema;
  const now = new Date().toISOString(), checked = args.lastCheckedAt || now, acknowledged = args.acknowledged === "true" ? 1 : 0;
  executeFile(`${schema}\nINSERT INTO ${table} (${idColumn},acknowledged,acknowledgement_type,acknowledgement_detail,work_status,summary,updates_json,last_checked_at,updated_at) SELECT id,${acknowledged},${nullable(args.acknowledgementType)},${nullable(args.acknowledgementDetail)},${sqlText(args.workStatus)},${sqlText(args.summary)},${sqlText(args.updatesJson)},${sqlText(checked)},${sqlText(now)} FROM ${sourceTable} WHERE dedupe_key=${sqlText(args.dedupeKey)} ON CONFLICT(${idColumn}) DO UPDATE SET acknowledged=excluded.acknowledged,acknowledgement_type=excluded.acknowledgement_type,acknowledgement_detail=excluded.acknowledgement_detail,work_status=excluded.work_status,summary=excluded.summary,updates_json=excluded.updates_json,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at;`);
  console.log(`Updated insight: ${args.dedupeKey} — ${args.workStatus}`);
}

function getCheckpoint(args) {
  required(args, ["monitorId"]); executeFile(checkpointSchema);
  const row = query(`SELECT monitor_id,last_successful_ts,last_successful_at FROM monitor_state WHERE monitor_id=${sqlText(args.monitorId)}`)[0];
  console.log(JSON.stringify(row ? { monitorId: row.monitor_id, lastSuccessfulTs: row.last_successful_ts, lastSuccessfulAt: row.last_successful_at } : { monitorId: args.monitorId, lastSuccessfulTs: "", lastSuccessfulAt: "" }));
}

function updateCheckpoint(args) {
  required(args, ["monitorId", "lastSuccessfulTs", "lastSuccessfulAt"]);
  executeFile(`${checkpointSchema}\nINSERT INTO monitor_state (monitor_id,last_successful_ts,last_successful_at,updated_at) VALUES (${sqlText(args.monitorId)},${sqlText(args.lastSuccessfulTs)},${sqlText(args.lastSuccessfulAt)},${sqlText(new Date().toISOString())}) ON CONFLICT(monitor_id) DO UPDATE SET last_successful_ts=excluded.last_successful_ts,last_successful_at=excluded.last_successful_at,updated_at=excluded.updated_at;`);
  console.log(`Checkpoint updated: ${args.monitorId}`);
}

function getFastMonitorState(args) {
  required(args, ["monitorId"]);
  executeFile(`${assignmentSchema}\n${taskSchema}\n${fastMonitorSchema}`);
  const result = query(`SELECT json_object('cursors',json(COALESCE((SELECT json_group_object(cursor_key,last_seen_ts) FROM monitor_cursors WHERE monitor_id=${sqlText(args.monitorId)}),'{}')),'assignmentKeys',json(COALESCE((SELECT json_group_array(dedupe_key) FROM assignments WHERE dedupe_key IS NOT NULL),'[]')),'myTaskKeys',json(COALESCE((SELECT json_group_array(dedupe_key) FROM my_tasks WHERE dedupe_key IS NOT NULL),'[]')),'candidateKeys',json(COALESCE((SELECT json_group_array(dedupe_key) FROM monitor_candidates),'[]'))) AS state`)[0];
  console.log(JSON.stringify({ monitorId: args.monitorId, ...JSON.parse(result?.state || "{}") }));
}

function applyFastMonitorCycle(args) {
  required(args, ["input"]);
  const payload = JSON.parse(readFileSync(resolve(args.input), "utf8"));
  required(payload, ["monitorId", "runId", "startedAt", "finishedAt", "ceilingTs"]);
  const assignmentsToCapture = Array.isArray(payload.assignments) ? payload.assignments : [];
  const myTasksToCapture = Array.isArray(payload.myTasks) ? payload.myTasks : [];
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const cursors = payload.cursors && typeof payload.cursors === "object" ? payload.cursors : {};
  const now = new Date().toISOString();
  const sql = [`${assignmentSchema}\n${taskSchema}\n${fastMonitorSchema}`];
  for (const item of assignmentsToCapture) {
    required(item, ["assignee", "assignment", "threadUrl", "assignedAt", "dedupeKey"]);
    if (!config.assignees.some((person) => person.name === item.assignee)) throw new Error(`Unconfigured assignee: ${item.assignee}`);
    sql.push(`INSERT OR IGNORE INTO assignments (id,assignee,assignment,thread_url,assigned_at,due_date,completed,archived,source,dedupe_key,created_at) VALUES (${sqlText(crypto.randomUUID())},${sqlText(item.assignee)},${sqlText(item.assignment)},${sqlText(item.threadUrl)},${sqlText(item.assignedAt)},${nullable(item.dueDate)},0,0,'fast_monitor',${sqlText(item.dedupeKey)},${sqlText(now)});`);
  }
  for (const item of myTasksToCapture) {
    required(item, ["requester", "requestType", "task", "threadUrl", "askedAt", "dedupeKey"]);
    if (!["task", "question", "input", "approval", "review"].includes(item.requestType)) throw new Error(`Invalid request type: ${item.requestType}`);
    sql.push(`INSERT OR IGNORE INTO my_tasks (id,requester,request_type,task,thread_url,asked_at,due_date,completed,archived,source,dedupe_key,created_at) VALUES (${sqlText(crypto.randomUUID())},${sqlText(item.requester)},${sqlText(item.requestType)},${sqlText(item.task)},${sqlText(item.threadUrl)},${sqlText(item.askedAt)},${nullable(item.dueDate)},0,0,'fast_monitor',${sqlText(item.dedupeKey)},${sqlText(now)});`);
  }
  for (const item of candidates) {
    required(item, ["dedupeKey", "ledger", "channelId", "messageTs", "text", "threadUrl", "reason"]);
    sql.push(`INSERT OR IGNORE INTO monitor_candidates (dedupe_key,ledger,channel_id,message_ts,author_id,target_id,text,thread_url,reason,status,detected_at) VALUES (${sqlText(item.dedupeKey)},${sqlText(item.ledger)},${sqlText(item.channelId)},${sqlText(item.messageTs)},${nullable(item.authorId)},${nullable(item.targetId)},${sqlText(item.text)},${sqlText(item.threadUrl)},${sqlText(item.reason)},'pending',${sqlText(now)});`);
  }
  for (const [cursorKey, lastSeenTs] of Object.entries(cursors)) {
    sql.push(`INSERT INTO monitor_cursors (monitor_id,cursor_key,last_seen_ts,updated_at) VALUES (${sqlText(payload.monitorId)},${sqlText(cursorKey)},${sqlText(lastSeenTs)},${sqlText(now)}) ON CONFLICT(monitor_id,cursor_key) DO UPDATE SET last_seen_ts=excluded.last_seen_ts,updated_at=excluded.updated_at;`);
  }
  sql.push(`INSERT INTO monitor_runs (run_id,monitor_id,started_at,finished_at,ceiling_ts,conversations_checked,messages_checked,captured_count,candidate_count,outcome) VALUES (${sqlText(payload.runId)},${sqlText(payload.monitorId)},${sqlText(payload.startedAt)},${sqlText(payload.finishedAt)},${sqlText(payload.ceilingTs)},${Number(payload.conversationsChecked) || 0},${Number(payload.messagesChecked) || 0},${assignmentsToCapture.length + myTasksToCapture.length},${candidates.length},${sqlText(payload.outcome || "success")});`);
  executeFile(sql.join("\n"));
  if (desktopNotificationsEnabled()) for (const item of myTasksToCapture) showDesktopNotification(item.requester, item.task);
  console.log(JSON.stringify({ assignments: assignmentsToCapture.length, myTasks: myTasksToCapture.length, candidates: candidates.length, cursors: Object.keys(cursors).length }));
}

function listPendingCandidates(args) {
  const limit = Math.max(1, Math.min(500, Number(args.limit) || 100));
  executeFile(fastMonitorSchema);
  console.log(JSON.stringify(query(`SELECT dedupe_key,ledger,channel_id,message_ts,author_id,target_id,text,thread_url,reason,detected_at FROM monitor_candidates WHERE status='pending' ORDER BY message_ts ASC LIMIT ${limit}`)));
}

function resolveMonitorCandidate(args) {
  required(args, ["dedupeKey", "status"]);
  if (!["captured", "ignored"].includes(args.status)) throw new Error("Candidate status must be captured or ignored.");
  executeFile(`${fastMonitorSchema}\nUPDATE monitor_candidates SET status=${sqlText(args.status)},processed_at=${sqlText(new Date().toISOString())} WHERE dedupe_key=${sqlText(args.dedupeKey)} AND status='pending';`);
  console.log(`Candidate resolved: ${args.dedupeKey} — ${args.status}`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
try {
  if (command === "capture-assignment") captureAssignment(args);
  else if (command === "capture-my-task") captureMyTask(args);
  else if (command === "test-desktop-notification") { required(args, ["requester", "task"]); showDesktopNotification(args.requester, args.task); }
  else if (command === "update-assignment-insight") updateInsight(args, false);
  else if (command === "update-my-task-insight") updateInsight(args, true);
  else if (command === "get-checkpoint") getCheckpoint(args);
  else if (command === "update-checkpoint") updateCheckpoint(args);
  else if (command === "get-fast-monitor-state") getFastMonitorState(args);
  else if (command === "get-monitor-control") getMonitorControl();
  else if (command === "set-monitor-control") setMonitorControl(args);
  else if (command === "apply-fast-monitor-cycle") applyFastMonitorCycle(args);
  else if (command === "list-pending-candidates") listPendingCandidates(args);
  else if (command === "resolve-monitor-candidate") resolveMonitorCandidate(args);
  else throw new Error("Unknown ledger command.");
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
