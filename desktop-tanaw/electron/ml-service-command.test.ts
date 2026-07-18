import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { getMlServiceCommand } from "./ml-service-command";

describe("getMlServiceCommand", () => {
  it("synchronizes the locked project environment in development", () => {
    const pathExists = vi.fn(() => true);

    expect(
      getMlServiceCommand({
        isPackaged: false,
        pathExists,
        platform: "win32",
        serviceDir: "C:\\tanaw\\ml-service",
      }),
    ).toEqual({ command: "uv", args: ["run", "--frozen", "python", "main.py"] });
    expect(pathExists).not.toHaveBeenCalled();
  });

  it("preserves a prepared packaged Python runtime", () => {
    const serviceDir = "C:\\tanaw\\resources\\ml-service";

    expect(
      getMlServiceCommand({
        isPackaged: true,
        pathExists: () => true,
        platform: "win32",
        serviceDir,
      }),
    ).toEqual({
      command: path.join(serviceDir, ".venv", "Scripts", "python.exe"),
      args: ["main.py"],
    });
  });

  it("uses the locked uv environment when no packaged runtime is present", () => {
    expect(
      getMlServiceCommand({
        isPackaged: true,
        pathExists: () => false,
        platform: "linux",
        serviceDir: "/opt/tanaw/ml-service",
      }),
    ).toEqual({ command: "uv", args: ["run", "--frozen", "python", "main.py"] });
  });
});
