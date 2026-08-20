#!/usr/bin/env node
import { closeSync, existsSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { processIsLive, processRoots, projectProcesses, stopProcessTree } from "./process-management.mjs";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(projectPath, "data", "assignment-ledger");
const statePath = join(dataPath, "dashboard-service.json");
const servicePath = join(projectPath, "scripts", "dashboard-service.mjs");
const backendAddress = "http://localhost:3000";
const friendlyAddress = "http://tasks.localhost";
const markers = ["scripts/dashboard-service.mjs", "scripts/tasks-localhost-proxy.mjs", "node_modules/vinext/dist/cli.js dev", "workerd.exe serve", "/workerd serve"];

function readState() {
  if (!existsSync(statePath)) return null;
  try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return null; }
}
async function ready(url, proxy = false) {
  try {
    const response = await fetch(url);
    return response.ok && (!proxy || response.headers.get("x-assignment-ledger-proxy") === "1");
  } catch { return false; }
}
function managedProcesses() { return projectProcesses(projectPath, markers); }
function currentState() {
  const value = readState();
  if (!value || value.proxy !== "in-process" || !processIsLive(value.supervisorPid)) return null;
  const managed = managedProcesses();
  return managed.some(({ pid, commandLine }) => pid === Number(value.supervisorPid) && commandLine.replaceAll("\\", "/").toLowerCase().includes("scripts/dashboard-service.mjs")) ? value : null;
}
async function stop() {
  const processes = managedProcesses();
  for (const root of processRoots(processes)) stopProcessTree(root.pid);
  for (let attempt = 0; attempt < 40 && processes.some(({ pid }) => processIsLive(pid)); attempt += 1) await new Promise((done) => setTimeout(done, 100));
  rmSync(statePath, { force: true });
}
async function start() {
  const existing = currentState();
  if (existing && await ready(backendAddress) && await ready(friendlyAddress, true)) {
    for (const root of processRoots(managedProcesses())) if (root.pid !== Number(existing.supervisorPid)) stopProcessTree(root.pid);
    return existing;
  }
  await stop();
  const output = openSync(join(projectPath, ".dashboard.log"), "a");
  const errors = openSync(join(projectPath, ".dashboard.error.log"), "a");
  const child = spawn(process.execPath, [servicePath], {
    cwd: projectPath,
    detached: true,
    stdio: ["ignore", output, errors],
    windowsHide: true,
  });
  child.unref(); closeSync(output); closeSync(errors);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const value = currentState();
    if (value && await ready(backendAddress) && await ready(friendlyAddress, true)) return value;
    await new Promise((done) => setTimeout(done, 500));
  }
  await stop();
  throw new Error("The dashboard service did not become healthy. Review .dashboard.error.log.");
}

const command = process.argv[2] || "status";
try {
  if (command === "start") console.log(JSON.stringify({ running: true, ...(await start()) }));
  else if (command === "stop") { await stop(); console.log(JSON.stringify({ running: false })); }
  else if (command === "restart") { await stop(); console.log(JSON.stringify({ running: true, ...(await start()) })); }
  else if (command === "status") {
    const value = currentState();
    console.log(JSON.stringify(value ? { running: true, healthy: await ready(backendAddress) && await ready(friendlyAddress, true), ...value } : { running: false }));
  } else { console.error("Use start, stop, restart, or status."); process.exitCode = 1; }
} catch (error) { console.error(error.message); process.exitCode = 1; }
