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

  it("uses the bundled standalone runtime in a packaged build", () => {
    const serviceDir = "C:\\tanaw\\resources\\ml-service";

    expect(
      getMlServiceCommand({
        isPackaged: true,
        pathExists: () => true,
        platform: "win32",
        serviceDir,
      }),
    ).toEqual({
      command: path.join(serviceDir, "runtime", "tanaw-ml-service.exe"),
      args: [],
    });
  });

  it("refuses an incomplete package instead of requiring uv or the network", () => {
    expect(
      () =>
        getMlServiceCommand({
          isPackaged: true,
          pathExists: () => false,
          platform: "linux",
          serviceDir: "/opt/tanaw/ml-service",
        }),
    ).toThrow(/bundled ML runtime is missing/i);
  });
});
