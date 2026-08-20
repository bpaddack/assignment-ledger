#!/usr/bin/env node
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { processRoots, projectProcesses, stopProcessTree } from "./process-management.mjs";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(projectPath, "data", "assignment-ledger");
const pidPath = join(dataPath, "fast-monitor-service.json");
const logPath = join(dataPath, "fast-monitor.log");
const monitorPath = join(projectPath, "scripts", "slack-fast-monitor.mjs");

const markers = ["scripts/slack-fast-monitor.mjs --watch"];
function managed() { return projectProcesses(projectPath, markers); }
function state() {
  if (!existsSync(pidPath)) return null;
  try {
    const value = JSON.parse(readFileSync(pidPath, "utf8"));
    return managed().some(({ pid }) => pid === Number(value.pid)) ? value : null;
  }
  catch { return null; }
}

const command = process.argv[2] || "status";
if (command === "start") {
  const existing = state();
  if (existing) {
    for (const root of processRoots(managed())) if (root.pid !== Number(existing.pid)) stopProcessTree(root.pid);
    console.log(JSON.stringify({ running: true, ...existing })); process.exit(0);
  }
  for (const root of processRoots(managed())) stopProcessTree(root.pid);
  rmSync(pidPath, { force: true });
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [monitorPath, "--watch"], { cwd: projectPath, detached: true, windowsHide: true, stdio: ["ignore", logFd, logFd] });
  child.unref(); closeSync(logFd);
  const value = { pid: child.pid, startedAt: new Date().toISOString(), cadenceMinutes: 2, logPath };
  writeFileSync(pidPath, JSON.stringify(value, null, 2), "utf8");
  console.log(JSON.stringify({ running: true, ...value }));
} else if (command === "stop") {
  for (const root of processRoots(managed())) stopProcessTree(root.pid);
  rmSync(pidPath, { force: true });
  console.log(JSON.stringify({ running: false }));
} else if (command === "status") {
  const existing = state();
  if (!existing) rmSync(pidPath, { force: true });
  console.log(JSON.stringify(existing ? { running: true, ...existing } : { running: false, logPath }));
} else {
  console.error("Use start, stop, or status."); process.exit(1);
}
