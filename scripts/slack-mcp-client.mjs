import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseTomlValue(value) {
  const trimmed = value.trim();
  try { return JSON.parse(trimmed); } catch { return trimmed.replace(/^"|"$/g, ""); }
}

function codexConfigPath() {
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml");
}

export function readSlackMcpConfig() {
  const configPath = codexConfigPath();
  if (!existsSync(configPath)) throw new Error(`Codex MCP configuration was not found at ${configPath}. Run: ghost mcp all`);
  const lines = readFileSync(configPath, "utf8").split(/\r?\n/);
  let active = false;
  const values = {};
  for (const line of lines) {
    if (/^\s*\[mcp_servers\.slack\]\s*$/.test(line)) { active = true; continue; }
    if (active && /^\s*\[/.test(line)) break;
    if (!active) continue;
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (match) values[match[1]] = parseTomlValue(match[2]);
  }
  if (!values.command || !Array.isArray(values.args) || !values.args[0]) {
    throw new Error("The Slack MCP connector is unavailable. Run: ghost mcp all, then restart Codex.");
  }
  return { command: values.command, args: values.args, configPath };
}

function findGhostRoot(serverPath) {
  let current = resolve(dirname(serverPath));
  while (dirname(current) !== current) {
    if (current.toLowerCase().endsWith(`${process.platform === "win32" ? "\\" : "/"}mcp-servers`)) return current;
    current = dirname(current);
  }
  throw new Error(`Unable to locate the Ghost MCP runtime from ${serverPath}. Run: ghost mcp all`);
}

export async function connectSlackMcp() {
  const config = readSlackMcpConfig();
  const ghostRoot = findGhostRoot(config.args[0]);
  const clientModule = pathToFileURL(join(ghostRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "index.js")).href;
  const stdioModule = pathToFileURL(join(ghostRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "stdio.js")).href;
  const [{ Client }, { StdioClientTransport }] = await Promise.all([import(clientModule), import(stdioModule)]);
  const client = new Client({ name: "assignment-ledger-fast-monitor", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: config.command, args: config.args, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  await client.connect(transport);
  return {
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const message = result.content?.find((item) => item.type === "text")?.text || result.structuredContent?.error || `${name} failed`;
        throw new Error(`${message}${stderr ? `\n${stderr.trim()}` : ""}`);
      }
      return result.structuredContent || JSON.parse(result.content?.find((item) => item.type === "text")?.text || "{}");
    },
    async close() { await client.close(); },
  };
}
