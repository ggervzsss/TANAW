import { describe, expect, it } from "vitest";
import { buildWindowsListenerPidScript } from "./ml-service-process";

describe("Windows ML listener discovery", () => {
  it("terminates the listener pipeline before emitting its PID", () => {
    const script = buildWindowsListenerPidScript(8765);

    expect(script).toContain("-LocalPort 8765");
    expect(script).toContain("; if ($null -ne $conn)");
  });
});
