#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(projectPath, "data", "assignment-ledger");
const statePath = join(dataPath, "dashboard-service.json");
const dashboardCli = join(projectPath, "node_modules", "vinext", "dist", "cli.js");

mkdirSync(dataPath, { recursive: true });
const output = openSync(join(projectPath, ".dashboard.log"), "a");
const errors = openSync(join(projectPath, ".dashboard.error.log"), "a");

// This supervisor is the detached process. The dashboard stays attached to the
// hidden supervisor so workerd inherits that hidden console context on Windows.
const dashboard = spawn(process.execPath, [dashboardCli, "dev"], {
  cwd: projectPath,
  detached: false,
  stdio: ["ignore", output, errors],
  windowsHide: true,
});
closeSync(output);
closeSync(errors);

writeFileSync(statePath, JSON.stringify({
  supervisorPid: process.pid,
  dashboardPid: dashboard.pid,
  startedAt: new Date().toISOString(),
}, null, 2), "utf8");

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  dashboard.kill("SIGTERM");
  setTimeout(() => dashboard.kill("SIGKILL"), 5000).unref();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
dashboard.once("exit", (code, signal) => {
  rmSync(statePath, { force: true });
  process.exit(code ?? (signal ? 1 : 0));
});

