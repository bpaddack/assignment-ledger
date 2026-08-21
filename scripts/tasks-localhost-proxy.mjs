#!/usr/bin/env node
import http from "node:http";
import net from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { processIsLive } from "./process-management.mjs";

const listenHost = "127.0.0.1";
const listenPort = 80;
const targetHost = "localhost";
const targetPort = 3000;
const projectPath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manualStatePath = join(projectPath, "data", "assignment-ledger", "manual-monitor-run.json");
const manualRunnerPath = join(projectPath, "scripts", "manual-monitor-runner.mjs");
const monitorManagerPath = join(projectPath, "scripts", "manage-fast-monitor.mjs");
let manualChildPid = null;

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-assignment-ledger-proxy": "1" });
  response.end(JSON.stringify(value));
}
function manualState() {
  if (manualChildPid && processIsLive(manualChildPid)) return { running: true, pid: manualChildPid };
  if (!existsSync(manualStatePath)) return { running: false };
  try {
    const value = JSON.parse(readFileSync(manualStatePath, "utf8"));
    if (value.running && !processIsLive(value.pid)) return { ...value, running: false, outcome: "error", error: "The manual fetch process exited unexpectedly." };
    return value;
  } catch { return { running: false, outcome: "error", error: "Could not read manual fetch state." }; }
}
export function createFriendlyProxy() {
  const server = http.createServer((request, response) => {
    if (request.url === "/__local/monitor/status" && request.method === "GET") return json(response, 200, manualState());
    if (request.url === "/__local/monitor/run" && request.method === "POST") {
      const existing = manualState();
      if (existing.running) return json(response, 409, { error: "A full fetch is already running.", ...existing });
      const child = spawn(process.execPath, [manualRunnerPath], { cwd: projectPath, detached: true, windowsHide: true, stdio: "ignore" });
      manualChildPid = child.pid;
      child.unref();
      return json(response, 202, { running: true, pid: child.pid, startedAt: new Date().toISOString() });
    }
    if (request.url === "/__local/monitor/control" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        try {
          const { enabled } = JSON.parse(body || "{}");
          if (typeof enabled !== "boolean") return json(response, 400, { error: "enabled must be a boolean" });
          const result = spawnSync(process.execPath, [monitorManagerPath, enabled ? "start" : "stop"], { cwd: projectPath, encoding: "utf8", windowsHide: true });
          if (result.status !== 0) return json(response, 500, { error: (result.stderr || result.stdout || "Could not update listener process.").trim() });
          return json(response, 200, { enabled, listener: JSON.parse(result.stdout.trim()) });
        } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : "Invalid request" }); }
      });
      return;
    }
    const upstream = http.request({
      hostname: targetHost,
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `${targetHost}:${targetPort}` },
    }, (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers, "x-assignment-ledger-proxy": "1" };
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      upstreamResponse.pipe(response);
    });

    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain", "x-assignment-ledger-proxy": "1" });
      response.end("The Assignment Ledger is starting. Refresh in a moment.");
    });
    request.pipe(upstream);
  });

  server.on("upgrade", (request, socket, head) => {
    const upstream = net.connect(targetPort, targetHost, () => {
      const headers = Object.entries({ ...request.headers, host: `${targetHost}:${targetPort}` })
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.off("error", reject);
      server.on("error", (error) => console.error(`Friendly address error: ${error.message}`));
      resolveServer(server);
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createFriendlyProxy().then(() => {
    console.log(`Friendly local address ready at http://tasks.localhost (proxying localhost:${targetPort})`);
  }).catch((error) => {
    console.error(`Could not start http://tasks.localhost on ${listenHost}:${listenPort}: ${error.message}`);
    process.exit(1);
  });
}
