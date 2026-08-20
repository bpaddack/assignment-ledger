#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardManager = join(projectPath, "scripts", "manage-dashboard-service.mjs");
const monitorManager = join(projectPath, "scripts", "manage-fast-monitor.mjs");

function run(script, command) {
  const result = spawnSync(process.execPath, [script, command], { cwd: projectPath, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed.`);
  try { return JSON.parse(result.stdout.trim()); } catch { return { output: result.stdout.trim() }; }
}
function stop() {
  const monitor = run(monitorManager, "stop");
  const dashboard = run(dashboardManager, "stop");
  return { running: false, dashboard, monitor };
}
function start() {
  const dashboard = run(dashboardManager, "start");
  const monitor = run(monitorManager, "start");
  return { running: true, dashboard, monitor };
}

const command = process.argv[2] || "status";
try {
  if (command === "start") console.log(JSON.stringify(start()));
  else if (command === "stop") console.log(JSON.stringify(stop()));
  else if (command === "restart") { stop(); console.log(JSON.stringify(start())); }
  else if (command === "status") {
    const dashboard = run(dashboardManager, "status");
    const monitor = run(monitorManager, "status");
    console.log(JSON.stringify({ running: Boolean(dashboard.running && dashboard.healthy && monitor.running), dashboard, monitor }));
  } else { console.error("Use start, stop, restart, or status."); process.exitCode = 1; }
} catch (error) { console.error(error.message); process.exitCode = 1; }
