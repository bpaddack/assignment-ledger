import { spawnSync } from "node:child_process";

export function processIsLive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

export function listProcesses() {
  if (process.platform === "win32") {
    const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Could not inspect Windows processes.");
    if (!result.stdout.trim()) return [];
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      pid: Number(item.ProcessId),
      parentPid: Number(item.ParentProcessId),
      name: String(item.Name || ""),
      commandLine: String(item.CommandLine || ""),
    }));
  }

  const result = spawnSync("ps", ["-eo", "pid=,ppid=,comm=,args="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Could not inspect processes.");
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), name: match[3], commandLine: match[4] }] : [];
  });
}

export function projectProcesses(projectPath, markers) {
  const project = projectPath.replaceAll("\\", "/").toLowerCase();
  return listProcesses().filter((item) => {
    const command = item.commandLine.replaceAll("\\", "/").toLowerCase();
    return command.includes(project) && markers.some((marker) => command.includes(marker.toLowerCase()));
  });
}

export function processRoots(processes) {
  const ids = new Set(processes.map(({ pid }) => pid));
  return processes.filter(({ parentPid }) => !ids.has(parentPid));
}

export function stopProcessTree(pid) {
  if (!processIsLive(pid)) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 && processIsLive(pid)) throw new Error(result.stderr || result.stdout || `Could not stop process ${pid}.`);
    return;
  }
  try { process.kill(-pid, "SIGTERM"); } catch {
    try { process.kill(pid, "SIGTERM"); } catch { return; }
  }
}
