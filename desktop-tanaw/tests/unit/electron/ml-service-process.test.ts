import { describe, expect, it } from "vitest";
import {
  buildWindowsListenerPidScript,
  buildWindowsProcessInfoScript,
  buildWindowsTerminateTreeArgs,
  isWorkspaceProcess,
  parseProcessInfo,
  shouldTerminateExternalService,
  waitForListenerRelease,
  type ProcessInfo,
} from "../../../electron/ml-service-process";

const SERVICE_DIR = "C:\\Users\\dev\\TANAW\\desktop-tanaw\\ml-service";

function processTable(entries: Record<number, ProcessInfo>) {
  return async (pid: number) => entries[pid] ?? null;
}

describe("ML service ownership", () => {
  it("recognises a leftover workspace service whose socket belongs to the venv launcher's child", async () => {
    // The Windows venv python.exe starts uv's base interpreter, which owns the port.
    const table = processTable({
      18660: { parentPid: 12328, commandLine: '"C:\\Users\\dev\\AppData\\Roaming\\uv\\python\\cpython-3.14-windows-x86_64-none\\python.exe"  main.py' },
      12328: { parentPid: 16500, commandLine: '"C:\\Users\\dev\\TANAW\\desktop-tanaw\\ml-service\\.venv\\Scripts\\python.exe" main.py' },
    });
    await expect(isWorkspaceProcess(18660, SERVICE_DIR, table)).resolves.toBe(true);
  });

  it("matches a listener started directly from the workspace, whatever the path case or slashes", async () => {
    const table = processTable({ 40: { parentPid: null, commandLine: "c:/users/dev/tanaw/desktop-tanaw/ml-service/.venv/bin/python main.py" } });
    await expect(isWorkspaceProcess(40, SERVICE_DIR, table)).resolves.toBe(true);
  });

  it("leaves unrelated services and their parents alone", async () => {
    const table = processTable({
      50: { parentPid: 51, commandLine: "C:\\Python\\python.exe -m http.server 8765" },
      51: { parentPid: 52, commandLine: "C:\\Windows\\System32\\cmd.exe" },
      52: { parentPid: null, commandLine: '"C:\\Users\\dev\\TANAW\\desktop-tanaw\\ml-service\\.venv\\Scripts\\python.exe" main.py' },
    });
    // Only the listener and its direct parent are considered.
    await expect(isWorkspaceProcess(50, SERVICE_DIR, table)).resolves.toBe(false);
    await expect(isWorkspaceProcess(99, SERVICE_DIR, table)).resolves.toBe(false);
  });

  it("reads parent and command line from PowerShell and ps output", () => {
    expect(buildWindowsProcessInfoScript(18660)).toContain('Filter "ProcessId=18660"');
    expect(() => buildWindowsProcessInfoScript(-1)).toThrow("positive process ID");
    expect(parseProcessInfo('12328\r\n"C:\\py\\python.exe"  main.py\r\n', "win32")).toEqual({ parentPid: 12328, commandLine: '"C:\\py\\python.exe"  main.py' });
    expect(parseProcessInfo("  812 /home/dev/TANAW/desktop-tanaw/ml-service/.venv/bin/python main.py\n", "linux")).toEqual({
      parentPid: 812,
      commandLine: "/home/dev/TANAW/desktop-tanaw/ml-service/.venv/bin/python main.py",
    });
    expect(parseProcessInfo("", "win32")).toBeNull();
  });
});

describe("Windows ML listener discovery", () => {
  it("terminates the listener pipeline before emitting its PID", () => {
    const script = buildWindowsListenerPidScript(8765);

    expect(script).toContain("-LocalPort 8765");
    expect(script).toContain("; if ($null -ne $conn)");
  });

  it("force-terminates the complete Windows process tree", () => {
    expect(buildWindowsTerminateTreeArgs(13972)).toEqual(["/PID", "13972", "/T", "/F"]);
    expect(() => buildWindowsTerminateTreeArgs(0)).toThrow("positive process ID");
  });

  it("waits for the listening socket to disappear instead of relying on HTTP health", async () => {
    const listenerPids = [13972, 13972, null];

    await expect(waitForListenerRelease(async () => listenerPids.shift() ?? null, 100, 0)).resolves.toBe(true);
  });

  it("terminates a compatible workspace service inherited from an earlier desktop process", () => {
    expect(shouldTerminateExternalService(true, false)).toBe(true);
    expect(shouldTerminateExternalService(true, true)).toBe(false);
    expect(shouldTerminateExternalService(false, false)).toBe(false);
  });
});
