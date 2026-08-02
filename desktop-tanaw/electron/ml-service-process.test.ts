import { describe, expect, it } from "vitest";
import { buildWindowsListenerPidScript, buildWindowsTerminateTreeArgs, shouldTerminateExternalService, waitForListenerRelease } from "./ml-service-process";

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
