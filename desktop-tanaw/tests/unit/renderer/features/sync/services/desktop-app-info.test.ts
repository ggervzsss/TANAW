import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopAppInfo } from "../../../../../../src/features/sync/services/desktop-app-info";

describe("getDesktopAppInfo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is null in the browser preview, which has no app bridge", async () => {
    vi.stubGlobal("window", {});
    await expect(getDesktopAppInfo()).resolves.toBeNull();
  });

  it("reads the version and computer name from the app bridge", async () => {
    vi.stubGlobal("window", { tanawAppInfo: { get: vi.fn().mockResolvedValue({ version: "0.1.3", computerName: "FRONT-DESK-PC" }) } });
    await expect(getDesktopAppInfo()).resolves.toEqual({ version: "0.1.3", computerName: "FRONT-DESK-PC" });
  });

  it("checks what the bridge returns", async () => {
    vi.stubGlobal("window", { tanawAppInfo: { get: vi.fn().mockResolvedValue({ version: "0.1.3", computerName: "x".repeat(200) }) } });
    await expect(getDesktopAppInfo()).resolves.toEqual({ version: "0.1.3", computerName: "x".repeat(120) });
  });

  it("is null when the bridge fails or gives no version", async () => {
    vi.stubGlobal("window", { tanawAppInfo: { get: vi.fn().mockRejectedValue(new Error("IPC request rejected")) } });
    await expect(getDesktopAppInfo()).resolves.toBeNull();
    vi.stubGlobal("window", { tanawAppInfo: { get: vi.fn().mockResolvedValue(null) } });
    await expect(getDesktopAppInfo()).resolves.toBeNull();
  });
});
