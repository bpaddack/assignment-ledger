import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders both isolated assignment ledgers", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Assignment Ledger<\/title>/i);
  assert.match(html, /Direct Report Assignments/);
  assert.match(html, /My Tasks and Assignments/);
  assert.match(html, /Archived/);
  assert.match(html, /Data and scan checkpoints stay on this computer/);
});

test("source defines inbound capture and durable checkpoint storage", async () => {
  const [tracker, schema, heartbeat, myTasksRoute] = await Promise.all([
    readFile(new URL("../app/AssignmentTracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../automation/HEARTBEAT_PROMPT_TEMPLATE.md", import.meta.url), "utf8"),
    readFile(new URL("../app/api/my-tasks/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(tracker, /\/api\/my-tasks/);
  assert.match(tracker, /assignment-ledger-my-task-notifications-enabled/);
  assert.match(tracker, /Desktop notifications/);
  assert.match(tracker, /api\/settings\/notifications/);
  assert.match(tracker, /even when the dashboard is closed/);
  assert.match(tracker, /task\.source!=="manual"/);
  assert.match(tracker, /Monitor and notification settings/);
  assert.match(tracker, /Heartbeat monitor/);
  assert.match(tracker, /Fetch latest tasks & assignments/);
  assert.match(tracker, /api\/settings\/monitor/);
  assert.match(tracker, /__local\/monitor\/run/);
  assert.match(tracker, /<small>Today<\/small>/);
  assert.match(tracker, /statusRows\.map/);
  assert.match(tracker, /href=\{item\.threadUrl\}/);
  assert.doesNotMatch(tracker, /__assignment-ledger\/open-slack/);
  assert.match(tracker, /dateOnly\?new Date/);
  assert.match(myTasksRoute, /created_at AS createdAt/);
  assert.match(schema, /sqliteTable\("my_tasks"/);
  assert.match(schema, /sqliteTable\("monitor_state"/);
  assert.match(schema, /sqliteTable\("monitor_cursors"/);
  assert.match(schema, /sqliteTable\("monitor_candidates"/);
  assert.match(schema, /sqliteTable\("monitor_runs"/);
  assert.match(schema, /archived: integer\("archived"\)/);
  assert.match(heartbeat, /GENERAL CHECKPOINT RULE/);
  assert.match(heartbeat, /PAUSE GATE/);
  assert.match(heartbeat, /LOCAL DISCOVERY AND REVIEW QUEUE/);
  assert.match(heartbeat, /resolve-monitor-candidate/);
  assert.match(heartbeat, /waiting_on_requester/);
});

test("listener emits cross-platform desktop notifications only for new inbound captures", () => {
  const cli = readFileSync(resolve("scripts/ledger-cli.mjs"), "utf8");
  assert.match(cli, /desktop_notifications_enabled/);
  assert.match(cli, /Windows\.UI\.Notifications/);
  assert.match(cli, /osascript/);
  assert.match(cli, /!alreadyCaptured && desktopNotificationsEnabled\(\)/);
});

test("portable launcher exposes the friendly loopback-only hostname", async () => {
  const [launcher, appManager, manager, service, proxy, configurator] = await Promise.all([
    readFile(new URL("../scripts/launch-dashboard.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/manage-app.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/manage-dashboard-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/dashboard-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/tasks-localhost-proxy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/configure-friendly-host.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(launcher, /http:\/\/tasks\.localhost/);
  assert.match(launcher, /http:\/\/localhost:3000/);
  assert.match(launcher, /manage-fast-monitor\.mjs/);
  assert.match(launcher, /manage-dashboard-service\.mjs/);
  assert.match(launcher, /explorer\.exe/);
  assert.doesNotMatch(launcher, /spawn\("cmd"/);
  assert.doesNotMatch(launcher, /spawn\(npm, \["run", "dev"\]/);
  assert.match(launcher, /detached: true/);
  assert.match(service, /node_modules["'], ["']vinext["'], ["']dist["'], ["']cli\.js/);
  assert.match(service, /detached: false/);
  assert.match(service, /dashboard-service\.json/);
  assert.match(service, /createFriendlyProxy/);
  assert.match(manager, /stopProcessTree/);
  assert.match(manager, /restart/);
  assert.match(appManager, /manage-fast-monitor\.mjs/);
  assert.match(appManager, /manage-dashboard-service\.mjs/);
  assert.match(proxy, /listenHost = "127\.0\.0\.1"/);
  assert.match(proxy, /targetHost = "localhost"/);
  assert.match(proxy, /listenPort = 80/);
  assert.match(proxy, /__local\/monitor\/control/);
  assert.match(proxy, /__local\/monitor\/run/);
  assert.doesNotMatch(proxy, /slack:\/\/channel\?team=/);
  assert.doesNotMatch(proxy, /__assignment-ledger\/open-slack/);
  assert.match(configurator, /127\.0\.0\.1 \$\{hostname\}/);
});

test("portable fast listener uses authenticated Slack, changed conversations, locking, and batched local persistence", async () => {
  const [monitor, client, manager, cli] = await Promise.all([
    readFile(new URL("../scripts/slack-fast-monitor.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/slack-mcp-client.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/manage-fast-monitor.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ledger-cli.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(client, /mcp_servers\\\.slack/);
  assert.match(monitor, /fast-monitor\.lock/);
  assert.match(monitor, /activeIms/);
  assert.match(monitor, /apply-fast-monitor-cycle/);
  assert.match(monitor, /options\.full/);
  assert.match(monitor, /get-monitor-control/);
  assert.match(manager, /--watch/);
  assert.match(manager, /paused: true/);
  assert.match(cli, /heartbeat_monitor_enabled/);
  assert.match(cli, /resolve-monitor-candidate/);
});
