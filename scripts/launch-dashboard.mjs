#!/usr/bin/env node
import { existsSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";

const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardService = join(projectPath, "scripts", "dashboard-service.mjs");
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
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", address], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", [address], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [address], { detached: true, stdio: "ignore" }).unref();
}

if (!existsSync(join(projectPath, "node_modules"))) {
  console.log("Installing required packages for this computer…");
  const install = spawnSync(npm, ["install"], { cwd: projectPath, stdio: "inherit", shell: process.platform === "win32" });
  if (install.status !== 0) process.exit(install.status || 1);
}

if (!(await isReady(backendAddress))) {
  const output = openSync(join(projectPath, ".dashboard.log"), "a");
  const errors = openSync(join(projectPath, ".dashboard.error.log"), "a");
  // Detach a hidden, long-lived supervisor. The dashboard remains attached to
  // that supervisor so workerd cannot allocate a visible Windows Terminal tab.
  spawn(process.execPath, [dashboardService], {
    cwd: projectPath,
    detached: true,
    stdio: ["ignore", output, errors],
    windowsHide: true,
  }).unref();
  for (let attempt = 0; attempt < 60 && !(await isReady(backendAddress)); attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
}

if (!(await isReady(backendAddress))) {
  console.error("The dashboard did not start. Review .dashboard.error.log in the project folder.");
  process.exit(1);
}

if (!(await isHostnameReady())) {
  console.error("tasks.localhost is not registered on this computer. Run npm run configure:hostname with administrator permission, then run npm run launch again.");
  process.exit(1);
}

if (!(await isFriendlyAddressReady())) {
  const output = openSync(join(projectPath, ".friendly-address.log"), "a");
  const errors = openSync(join(projectPath, ".friendly-address.error.log"), "a");
  spawn(process.execPath, [join(projectPath, "scripts", "tasks-localhost-proxy.mjs")], { cwd: projectPath, detached: true, stdio: ["ignore", output, errors], windowsHide: true }).unref();
  for (let attempt = 0; attempt < 30 && !(await isFriendlyAddressReady()); attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 500));
}

if (!(await isFriendlyAddressReady())) {
  console.error("The friendly address could not use local port 80. On macOS or Linux, approve the privileged local port by running: sudo npm run launch");
  console.error("Review .friendly-address.error.log in the project folder for details.");
  process.exit(1);
}

const monitorStart = spawnSync(process.execPath, [join(projectPath, "scripts", "manage-fast-monitor.mjs"), "start"], { cwd: projectPath, encoding: "utf8", windowsHide: true });
if (monitorStart.status !== 0) {
  console.error("The fast Slack listener could not start. Run npm run monitor:fast:probe to verify the authenticated Slack connector.");
  console.error(monitorStart.stderr || monitorStart.stdout);
  process.exit(monitorStart.status || 1);
}
if (openOnLaunch) openBrowser();
console.log(`Assignment Ledger is running at ${address}. The fast Slack listener is active.`);
