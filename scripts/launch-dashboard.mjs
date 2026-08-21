#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardManager = join(projectPath, "scripts", "manage-dashboard-service.mjs");
const backendAddress = "http://localhost:3000";
const address = "http://tasks.localhost";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const openOnLaunch = !process.argv.includes("--no-open");

async function isReady(target) { try { return (await fetch(target)).ok; } catch { return false; } }
async function isHostnameReady() {
  try {
    const addresses = await lookup("tasks.localhost", { all: true });
    return addresses.some(({ address }) => address === "127.0.0.1" || address === "::1");
  } catch {
    return false;
  }
}
async function isFriendlyAddressReady() {
  try {
    const response = await fetch(address);
    return response.ok && response.headers.get("x-assignment-ledger-proxy") === "1";
  } catch {
    return false;
  }
}
function openBrowser() {
  if (process.platform === "win32") spawn("explorer.exe", [address], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  else if (process.platform === "darwin") spawn("open", [address], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [address], { detached: true, stdio: "ignore" }).unref();
}

if (!existsSync(join(projectPath, "node_modules"))) {
  console.log("Installing required packages for this computer…");
  const install = spawnSync(npm, ["install"], { cwd: projectPath, stdio: "inherit", shell: process.platform === "win32" });
  if (install.status !== 0) process.exit(install.status || 1);
}

if (!(await isHostnameReady())) {
  console.error("tasks.localhost is not registered on this computer. Run npm run configure:hostname with administrator permission, then run npm run launch again.");
  process.exit(1);
}

const dashboardStart = spawnSync(process.execPath, [dashboardManager, "start"], { cwd: projectPath, encoding: "utf8", windowsHide: true });
if (dashboardStart.status !== 0 || !(await isReady(backendAddress)) || !(await isFriendlyAddressReady())) {
  console.error("The dashboard could not start cleanly. Review .dashboard.error.log in the project folder.");
  console.error(dashboardStart.stderr || dashboardStart.stdout);
  process.exit(dashboardStart.status || 1);
}

const monitorStart = spawnSync(process.execPath, [join(projectPath, "scripts", "manage-fast-monitor.mjs"), "start"], { cwd: projectPath, encoding: "utf8", windowsHide: true });
if (monitorStart.status !== 0) {
  console.error("The fast Slack listener could not start. Run npm run monitor:fast:probe to verify the authenticated Slack connector.");
  console.error(monitorStart.stderr || monitorStart.stdout);
  process.exit(monitorStart.status || 1);
}
if (openOnLaunch) openBrowser();
let monitorState = { paused: false };
try { monitorState = JSON.parse(monitorStart.stdout.trim()); } catch { /* status already validated */ }
console.log(`Assignment Ledger is running at ${address}. The Slack listener is ${monitorState.paused ? "paused" : "active"}.`);
