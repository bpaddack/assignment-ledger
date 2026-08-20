#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";

const hostname = "tasks.localhost";
const hostsPath = process.platform === "win32"
  ? `${process.env.SystemRoot || "C:\\Windows"}\\System32\\drivers\\etc\\hosts`
  : "/etc/hosts";

const contents = await readFile(hostsPath, "utf8");
const activeLines = contents
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*/, "").trim())
  .filter(Boolean);
const alreadyConfigured = activeLines.some((line) => {
  const [address, ...names] = line.split(/\s+/);
  return (address === "127.0.0.1" || address === "::1") && names.includes(hostname);
});

if (alreadyConfigured) {
  console.log(`${hostname} is already registered in ${hostsPath}`);
  process.exit(0);
}

if (!process.argv.includes("--apply")) {
  console.error(`${hostname} is not registered. Run this command with administrator permission: node scripts/configure-friendly-host.mjs --apply`);
  process.exit(2);
}

try {
  const separator = contents.endsWith("\n") ? "" : "\n";
  await appendFile(hostsPath, `${separator}127.0.0.1 ${hostname} # Assignment Ledger\n`, "utf8");
  console.log(`Registered ${hostname} as a loopback-only address in ${hostsPath}`);
} catch (error) {
  if (error?.code === "EACCES" || error?.code === "EPERM") {
    console.error(`Administrator permission is required to update ${hostsPath}.`);
    console.error(process.platform === "win32"
      ? "Open an Administrator terminal in this project and run: npm run configure:hostname"
      : "Run: sudo npm run configure:hostname");
    process.exit(3);
  }
  throw error;
}
