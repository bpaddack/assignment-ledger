#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(projectPath, "data", "assignment-ledger");
const statePath = join(dataPath, "manual-monitor-run.json");
const monitorPath = join(projectPath, "scripts", "slack-fast-monitor.mjs");
const startedAt = new Date().toISOString();

mkdirSync(dataPath, { recursive: true });
writeFileSync(statePath, JSON.stringify({ running: true, pid: process.pid, startedAt }, null, 2), "utf8");

const result = spawnSync(process.execPath, [monitorPath, "--full"], {
  cwd: projectPath,
  encoding: "utf8",
  windowsHide: true,
});
let details = null;
try { details = JSON.parse(result.stdout.trim()); } catch { /* retain raw output below */ }
const error = result.status === 0 ? null : (result.stderr || result.stdout || "Manual fetch failed.").trim();
writeFileSync(statePath, JSON.stringify({
  running: false,
  pid: process.pid,
  startedAt,
  finishedAt: new Date().toISOString(),
  outcome: result.status === 0 ? "success" : "error",
  details,
  error,
}, null, 2), "utf8");
process.exitCode = result.status || 0;
