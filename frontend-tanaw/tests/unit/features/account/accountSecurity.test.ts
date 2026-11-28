import { describe, expect, it } from "vitest";
import { accountStanding, describeUserAgent, formatAuthenticatorKey, governanceRoleLabel, recoveryCodesFileText, signedInLabel, systemRoleLabel } from "@/features/account/model";

const userAgents = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  samsungAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  operaWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

describe("active session device", () => {
  it("names the browser and the system from the user agent", () => {
    expect(describeUserAgent(userAgents.chromeWindows)).toBe("Chrome on Windows");
    expect(describeUserAgent(userAgents.edgeWindows)).toBe("Edge on Windows");
    expect(describeUserAgent(userAgents.firefoxLinux)).toBe("Firefox on Linux");
    expect(describeUserAgent(userAgents.safariMac)).toBe("Safari on macOS");
    expect(describeUserAgent(userAgents.safariIphone)).toBe("Safari on iPhone");
    expect(describeUserAgent(userAgents.chromeIphone)).toBe("Chrome on iPhone");
    expect(describeUserAgent(userAgents.chromeAndroid)).toBe("Chrome on Android");
    expect(describeUserAgent(userAgents.samsungAndroid)).toBe("Samsung Internet on Android");
    expect(describeUserAgent(userAgents.operaWindows)).toBe("Opera on Windows");
    expect(describeUserAgent(userAgents.chromebook)).toBe("Chrome on ChromeOS");
  });

  it("says less rather than guessing", () => {
    expect(describeUserAgent("")).toBe("This browser");
    expect(describeUserAgent("SomeBot/1.0")).toBe("This browser");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Unknown/1.0")).toBe("Browser on Windows");
  });

  it("shows when this device signed in in the system formats", () => {
    expect(signedInLabel("2026-11-26T00:15:00Z", "MMM d, yyyy", "12-hour")).toBe("Signed in Nov 26, 2026 · 8:15 AM");
    expect(signedInLabel("2026-11-26T12:05:00Z", "yyyy-MM-dd", "24-hour")).toBe("Signed in 2026-11-26 · 20:05");
    expect(signedInLabel(null, "MMM d, yyyy", "12-hour")).toBe("Sign-in time unavailable");
    expect(signedInLabel("not a date", "MMM d, yyyy", "12-hour")).toBe("Sign-in time unavailable");
  });
});

describe("governance details", () => {
  it("keeps one label per LGU role", () => {
    expect(governanceRoleLabel).toEqual({
      admin: "Municipal Admin (Executive Oversight)",
      it: "IT Personnel (System Administration)",
      staff: "LGU Staff (Report Review)",
    });
    expect(systemRoleLabel("staff")).toBe("LGU Staff (Report Review)");
    expect(systemRoleLabel("enterprise")).toBe("Enterprise Account");
  });

  it("reads the account standing from its status and activation", () => {
    expect(accountStanding({ status: "active", isActivated: true })).toEqual({ label: "Active · Verified", tone: "success" });
    expect(accountStanding({ status: "active", isActivated: false })).toEqual({ label: "Active · Not verified", tone: "warning" });
    expect(accountStanding({ status: "inactive", isActivated: true })).toEqual({ label: "Inactive", tone: "neutral" });
    expect(accountStanding({})).toEqual({ label: "Status unavailable", tone: "neutral" });
    expect(accountStanding(null)).toEqual({ label: "Status unavailable", tone: "neutral" });
  });
});

describe("two-step setup", () => {
  it("shows the setup key in groups of four", () => {
    expect(formatAuthenticatorKey("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).toBe("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ");
    expect(formatAuthenticatorKey("abcdefg")).toBe("ABCD EFG");
    expect(formatAuthenticatorKey("")).toBe("");
  });

  it("writes the recovery codes file with the account and one code per line", () => {
    const text = recoveryCodesFileText(["AAAAA-BBBBB", "CCCCC-DDDDD"], { email: "staff@example.com", savedOn: "Nov 28, 2026, 9:00 AM" });

    expect(text).toContain("Account: staff@example.com");
    expect(text).toContain("Created: Nov 28, 2026, 9:00 AM");
    expect(text).toContain(" 1. AAAAA-BBBBB\n 2. CCCCC-DDDDD\n");
    expect(text).toContain("Each code works once.");
  });
});
