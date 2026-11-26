import { describe, expect, it } from "vitest";
import { MAX_DESKTOP_APP_VERSION_LENGTH, MAX_DESKTOP_COMPUTER_NAME_LENGTH, normalizeDesktopAppInfo } from "../../../../src/types/desktop-app-info";

describe("normalizeDesktopAppInfo", () => {
  it("keeps a version and computer name TANAW accepts", () => {
    expect(normalizeDesktopAppInfo({ version: " 0.1.3 ", computerName: " FRONT-DESK-PC " })).toEqual({ version: "0.1.3", computerName: "FRONT-DESK-PC" });
  });

  it("trims a long computer name and version to the accepted lengths", () => {
    const info = normalizeDesktopAppInfo({ version: "9".repeat(60), computerName: "pc".repeat(100) });
    expect(info?.version).toHaveLength(MAX_DESKTOP_APP_VERSION_LENGTH);
    expect(info?.computerName).toHaveLength(MAX_DESKTOP_COMPUTER_NAME_LENGTH);
  });

  it("sends a null computer name when it is missing, blank or not text", () => {
    expect(normalizeDesktopAppInfo({ version: "0.1.3" })).toEqual({ version: "0.1.3", computerName: null });
    expect(normalizeDesktopAppInfo({ version: "0.1.3", computerName: "  \n" })).toEqual({ version: "0.1.3", computerName: null });
    expect(normalizeDesktopAppInfo({ version: "0.1.3", computerName: 42 })).toEqual({ version: "0.1.3", computerName: null });
  });

  it("drops control characters from the computer name", () => {
    expect(normalizeDesktopAppInfo({ version: "0.1.3", computerName: "FRONT\u0000DESK\u0007" })?.computerName).toBe("FRONTDESK");
  });

  it("gives no app info without a usable version", () => {
    expect(normalizeDesktopAppInfo(null)).toBeNull();
    expect(normalizeDesktopAppInfo("0.1.3")).toBeNull();
    expect(normalizeDesktopAppInfo({ computerName: "PC" })).toBeNull();
    expect(normalizeDesktopAppInfo({ version: "   ", computerName: "PC" })).toBeNull();
  });
});
