export function buildWindowsListenerPidScript(port: number) {
  return [
    `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
    "| Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::1' }",
    "| Select-Object -First 1",
    "; if ($null -ne $conn) { $conn.OwningProcess }",
  ].join(" ");
}

export function buildWindowsTerminateTreeArgs(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("A positive process ID is required.");
  }
  return ["/PID", String(pid), "/T", "/F"];
}

export async function waitForListenerRelease(findListenerPid: () => Promise<number | null>, timeoutMs: number, pollIntervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await findListenerPid()) === null) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

export function shouldTerminateExternalService(connectedExternally: boolean, hasManagedProcess: boolean) {
  return connectedExternally && !hasManagedProcess;
}

export type ProcessInfo = { commandLine: string | null; parentPid: number | null };

/** Prints the parent PID on the first line and the command line after it. */
export function buildWindowsProcessInfoScript(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("A positive process ID is required.");
  }
  return `$proc = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; if ($proc) { [string]$proc.ParentProcessId; $proc.CommandLine }`;
}

/** Parses `buildWindowsProcessInfoScript` output, or `ps -o ppid=,command=` output on macOS and Linux. */
export function parseProcessInfo(output: string, platform: NodeJS.Platform): ProcessInfo | null {
  const text = output.trim();
  if (!text) return null;
  const [first, rest] = platform === "win32" ? splitFirstLine(text) : splitFirstWord(text);
  const parentPid = Number.parseInt(first, 10);
  return {
    parentPid: Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null,
    commandLine: rest.trim() || null,
  };
}

/**
 * Whether the process listening for the ML service was started from this workspace.
 *
 * On Windows the virtual environment's python.exe is only a launcher: it starts the base
 * interpreter (for example uv's managed CPython) as a child, and that child owns the socket.
 * Its command line does not mention the workspace, so the launcher above it is checked too.
 */
export async function isWorkspaceProcess(pid: number, serviceDir: string, getProcessInfo: (pid: number) => Promise<ProcessInfo | null>, ancestors = 1) {
  const workspace = normalizeCommandPath(serviceDir);
  let current: number | null = pid;
  for (let depth = 0; current !== null && depth <= ancestors; depth += 1) {
    const info = await getProcessInfo(current);
    if (!info) return false;
    if (info.commandLine && normalizeCommandPath(info.commandLine).includes(workspace)) return true;
    current = info.parentPid;
  }
  return false;
}

function normalizeCommandPath(value: string) {
  return value.split("\\").join("/").replace(/\/{2,}/g, "/").replace(/\/$/, "").toLowerCase();
}

function splitFirstLine(text: string): [string, string] {
  const index = text.search(/\r?\n/);
  return index < 0 ? [text, ""] : [text.slice(0, index), text.slice(index).replace(/^\r?\n/, "")];
}

function splitFirstWord(text: string): [string, string] {
  const match = /^(\S+)\s*([\s\S]*)$/.exec(text);
  return match ? [match[1], match[2]] : [text, ""];
}
