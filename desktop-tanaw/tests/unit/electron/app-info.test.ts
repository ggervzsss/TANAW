import { describe, expect, it } from "vitest";
import { readDesktopAppInfo } from "../../../electron/app-info";

describe("readDesktopAppInfo", () => {
  it("reports the Electron app version and the computer's host name", () => {
    expect(readDesktopAppInfo({ getVersion: () => "0.1.3", hostname: () => "FRONT-DESK-PC" })).toEqual({ version: "0.1.3", computerName: "FRONT-DESK-PC" });
  });

  it("trims a host name longer than TANAW accepts to 120 characters", () => {
    expect(readDesktopAppInfo({ getVersion: () => "0.1.3", hostname: () => "a".repeat(300) })?.computerName).toBe("a".repeat(120));
  });

  it("still reports the version when the host name cannot be read", () => {
    const info = readDesktopAppInfo({
      getVersion: () => "0.1.3",
      hostname: () => {
        throw new Error("uv_os_gethostname failed");
      },
    });
    expect(info).toEqual({ version: "0.1.3", computerName: null });
  });

  it("gives no app info when the version cannot be read", () => {
    const info = readDesktopAppInfo({
      getVersion: () => {
        throw new Error("app not ready");
      },
      hostname: () => "FRONT-DESK-PC",
    });
    expect(info).toBeNull();
  });
});
