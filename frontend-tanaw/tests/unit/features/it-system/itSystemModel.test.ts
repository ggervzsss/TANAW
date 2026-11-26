import { describe, expect, it } from "vitest";
import {
  activityDayLabel,
  activityIdFields,
  activityOriginFields,
  changedSettingsPayload,
  changesLockout,
  cleanupText,
  dateFormatOptions,
  DEFAULT_SETTINGS_FORM,
  emailKindLabel,
  emailRecipientLine,
  emailResult,
  emailResultDetail,
  failedEmailCount,
  filterEmailLog,
  filterSystemActivity,
  isSettingsDirty,
  itActorRoleLabel,
  lastChangedText,
  parseSystemActivityFilter,
  parseSystemTab,
  settingsFormFromValues,
  summarizeUserAgent,
  systemActivityLinks,
  systemActivityRow,
  systemActivityType,
  timeFormatOptions,
  visibleActivityCount,
  type EmailLogEntry,
  type SystemActivityLog,
} from "../../../../src/features/it-system/model";

function log(overrides: Partial<SystemActivityLog> & Pick<SystemActivityLog, "id">): SystemActivityLog {
  return {
    timestamp: "2026-11-25T06:00:00.000Z",
    group: "Login & Security",
    severity: "Info",
    actor: "Ana Reyes",
    actorRole: "IT Personnel",
    action: "Login",
    target: "ana@example.com",
    summary: "Ana Reyes signed in to TANAW.",
    ...overrides,
  };
}

function email(overrides: Partial<EmailLogEntry> & Pick<EmailLogEntry, "id">): EmailLogEntry {
  return {
    purpose: "account_activation",
    recipient: "museum@example.test",
    provider: "brevo",
    status: "accepted",
    attemptCount: 1,
    maxAttempts: 5,
    manualRetryCount: 0,
    nextAttemptAt: null,
    providerMessageId: null,
    errorCode: null,
    failureReason: null,
    outcomeUncertain: false,
    canRetry: false,
    createdAt: "2026-11-25T06:00:00.000Z",
    acceptedAt: null,
    ...overrides,
  };
}

// 3:00 PM on Wed Nov 25, 2026 in Manila.
const now = new Date("2026-11-25T07:00:00.000Z");

describe("Activity types", () => {
  it("folds the backend groups into the five IT types", () => {
    expect(systemActivityType({ group: "Login & Security" })).toBe("security");
    expect(systemActivityType({ group: "Requests" })).toBe("requests");
    expect(systemActivityType({ group: "Accounts" })).toBe("accounts");
    expect(systemActivityType({ group: "Enterprises" })).toBe("enterprises");
    expect(systemActivityType({ group: "Monitoring" })).toBe("system");
    expect(systemActivityType({ group: "Settings & Maintenance" })).toBe("system");
    expect(systemActivityType({ group: "Reports" })).toBe("system");
  });

  it("filters by type, newest first, and reads only known filters and tabs", () => {
    const records = [
      log({ id: "old", timestamp: "2026-11-20T06:00:00.000Z" }),
      log({ id: "camera", group: "Monitoring", timestamp: "2026-11-24T06:00:00.000Z" }),
      log({ id: "new", timestamp: "2026-11-25T06:00:00.000Z" }),
    ];
    expect(filterSystemActivity(records, "all").map((record) => record.id)).toEqual(["new", "camera", "old"]);
    expect(filterSystemActivity(records, "system").map((record) => record.id)).toEqual(["camera"]);
    expect(parseSystemActivityFilter("enterprises")).toBe("enterprises");
    expect(parseSystemActivityFilter("monitoring")).toBe("all");
    expect(parseSystemTab("email")).toBe("email");
    expect(parseSystemTab(null)).toBe("activity");
    expect(parseSystemTab("logs")).toBe("activity");
  });

  it("builds a row with the day, title, actor role and type", () => {
    const row = systemActivityRow(log({ id: "start", group: "Requests", action: "Start Request", timestamp: "2026-11-24T02:00:00.000Z" }), now, "MMM d, yyyy");
    expect(row).toMatchObject({ day: "Yesterday", title: "Request Started", actor: "Ana Reyes", role: "IT", type: "requests", typeLabel: "Requests" });
    expect(itActorRoleLabel("System")).toBe("System");
    expect(itActorRoleLabel("LGU Staff")).toBe("Staff");
  });

  it("labels days in Philippine time and the system date format", () => {
    expect(activityDayLabel("2026-11-24T17:30:00.000Z", now, "MMM d, yyyy")).toBe("Today");
    expect(activityDayLabel("2026-11-24T15:30:00.000Z", now, "MMM d, yyyy")).toBe("Yesterday");
    expect(activityDayLabel("2026-11-22T02:00:00.000Z", now, "yyyy-MM-dd")).toBe("2026-11-22");
    expect(activityDayLabel("not a date", now, "MMM d, yyyy")).toBe("Date unavailable");
  });

  it("shows more rows a page at a time and always includes the linked row", () => {
    expect(visibleActivityCount(100, 1)).toBe(25);
    expect(visibleActivityCount(100, 2)).toBe(50);
    expect(visibleActivityCount(10, 1)).toBe(10);
    expect(visibleActivityCount(100, 1, 30)).toBe(50);
    expect(visibleActivityCount(40, 1, 30)).toBe(40);
  });
});

describe("Technical detail", () => {
  it("summarises user agents", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")).toBe("Chrome 131 on Windows");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86")).toBe("Edge 131 on Windows");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0")).toBe("Firefox 133 on Windows");
    expect(summarizeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe("Safari 17 on macOS");
    expect(summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari 17 on iOS");
    expect(summarizeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")).toBe("Chrome 131 on Android");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) desktop-tanaw/0.1.3 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36")).toBe(
      "TANAW desktop app 0.1.3 on Windows",
    );
    expect(summarizeUserAgent("python-httpx/0.27.0")).toBe("python-httpx 0.27.0");
    expect(summarizeUserAgent("  ")).toBeNull();
    expect(summarizeUserAgent(null)).toBeNull();
  });

  it("shows the IP address, browser and session, or says why they are missing", () => {
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
    expect(activityOriginFields(log({ id: "1", technical: { ipAddress: "10.12.4.18", userAgent, sessionId: "ses_1c90" } }))).toEqual([
      { label: "IP address", value: "10.12.4.18", mono: true },
      { label: "Browser", value: "Firefox 133 on Windows", detail: userAgent },
      { label: "Session", value: "ses_1c90", mono: true },
    ]);
    expect(activityOriginFields(log({ id: "2", technical: { ipAddress: "10.0.0.1" } }))[2]).toEqual({ label: "Session", value: "Not recorded", mono: false });
    expect(activityOriginFields(log({ id: "3", actorRole: "System", technical: null }))).toEqual([{ label: "Where from", value: "TANAW itself, not a browser" }]);
    expect(activityOriginFields(log({ id: "4" }))).toEqual([{ label: "Where from", value: "Not recorded" }]);
  });

  it("lists the IDs that trace a record and links to the IT screens", () => {
    const request = log({ id: "log-1", group: "Requests", action: "Reply to Request", sourceId: "sample:activity:request:req-9", metadata: { requestCode: "REQ-000149" } });
    expect(activityIdFields(request)).toEqual([
      { label: "Request", value: "REQ-000149", mono: true },
      { label: "Source ID", value: "req-9", mono: true },
      { label: "Activity ID", value: "log-1", mono: true },
    ]);
    expect(systemActivityLinks(request)).toEqual([{ label: "Open the request", to: "/it/requests?request=req-9" }]);
    const enterprise = log({ id: "log-2", group: "Enterprises", action: "Update Enterprise Account", metadata: { enterpriseId: "ENT-3" } });
    expect(systemActivityLinks(enterprise)).toEqual([{ label: "Open enterprise details", to: "/it/enterprises/ENT-3" }]);
  });
});

describe("Email log", () => {
  it("folds outbox statuses into Delivered, Sending and Not delivered", () => {
    expect(emailResult({ status: "accepted" })).toBe("delivered");
    expect(emailResult({ status: "recorded" })).toBe("delivered");
    expect(emailResult({ status: "queued" })).toBe("sending");
    expect(emailResult({ status: "processing" })).toBe("sending");
    expect(emailResult({ status: "retry_scheduled" })).toBe("sending");
    expect(emailResult({ status: "terminal_failed" })).toBe("failed");
    expect(emailResult({ status: "cancelled" })).toBe("failed");
    expect(emailResult({ status: "expired" })).toBe("failed");
    expect(emailResult({ status: "reconciliation_required" })).toBe("failed");
  });

  it("explains a failure with its reason, or a plain fallback", () => {
    expect(emailResultDetail(email({ id: "1", status: "terminal_failed", failureReason: "The mailbox is full" }))).toBe("The mailbox is full");
    expect(emailResultDetail(email({ id: "2", status: "expired" }))).toBe("It expired before it could be sent.");
    expect(emailResultDetail(email({ id: "3", status: "accepted" }))).toBe("");
    expect(emailResultDetail(email({ id: "4", status: "queued", manualRetryCount: 1 }))).toBe("Sending again");
  });

  it("names the kind of email and who it went to", () => {
    expect(emailKindLabel("account_activation")).toBe("Sign-in invitation");
    expect(emailKindLabel("password_reset")).toBe("Password reset code");
    expect(emailKindLabel("request_reply")).toBe("Request reply");
    expect(emailKindLabel("weekly_digest")).toBe("Weekly digest");
    expect(emailRecipientLine(email({ id: "1", recipientName: "Grace Bautista", recipientRole: "LGU Staff" }))).toBe("Grace Bautista, Staff");
    expect(emailRecipientLine(email({ id: "2", recipientName: "Laguna Lakeside Resort", recipientRole: "Enterprise Account" }))).toBe("Laguna Lakeside Resort, Enterprise");
    expect(emailRecipientLine(email({ id: "3" }))).toBe("");
  });

  it("counts failures and filters to problems, newest first", () => {
    const deliveries = [
      email({ id: "ok", createdAt: "2026-11-25T01:00:00.000Z" }),
      email({ id: "failed", status: "terminal_failed", canRetry: true, createdAt: "2026-11-24T01:00:00.000Z" }),
      email({ id: "newer", status: "queued", createdAt: "2026-11-25T05:00:00.000Z" }),
    ];
    expect(failedEmailCount(deliveries)).toBe(1);
    expect(filterEmailLog(deliveries, "all").map((delivery) => delivery.id)).toEqual(["newer", "ok", "failed"]);
    expect(filterEmailLog(deliveries, "problems").map((delivery) => delivery.id)).toEqual(["failed"]);
  });
});

describe("Settings form", () => {
  const values = {
    "security.loginAttemptLimit": 5,
    "security.loginLockMinutes": "30",
    "monitoring.cameraWaitMinutes": 60,
    "logs.retentionDays": 365,
    "display.dateFormat": "yyyy-MM-dd",
    "display.timeFormat": "24-hour",
  };

  it("reads saved values and falls back to the defaults for values the backend does not allow", () => {
    expect(settingsFormFromValues(values)).toEqual({ loginAttemptLimit: 5, loginLockMinutes: 30, cameraWaitMinutes: 60, retentionDays: 365, dateFormat: "yyyy-MM-dd", timeFormat: "24-hour" });
    expect(settingsFormFromValues({ "security.loginAttemptLimit": 7, "display.dateFormat": "dd.MM.yyyy" })).toEqual(DEFAULT_SETTINGS_FORM);
    expect(settingsFormFromValues(null)).toEqual(DEFAULT_SETTINGS_FORM);
  });

  it("is dirty only when a value changed, and sends only the changed keys", () => {
    const saved = settingsFormFromValues(values);
    expect(isSettingsDirty(saved, { ...saved })).toBe(false);
    const draft = { ...saved, retentionDays: 90, timeFormat: "12-hour" as const };
    expect(isSettingsDirty(saved, draft)).toBe(true);
    expect(changedSettingsPayload(saved, draft)).toEqual({ "logs.retentionDays": 90, "display.timeFormat": "12-hour" });
    expect(changesLockout(saved, draft)).toBe(false);
    expect(changesLockout(saved, { ...saved, loginLockMinutes: 60 })).toBe(true);
  });

  it("shows today in each date format and the time now in each time format", () => {
    expect(dateFormatOptions(now).map((option) => option.label)).toEqual(["Nov 25, 2026", "25 Nov 2026", "11/25/2026", "2026-11-25"]);
    expect(timeFormatOptions(now).map((option) => option.label)).toEqual(["3:00 PM (12-hour)", "15:00 (24-hour)"]);
  });

  it("describes the last cleanup and the last change", () => {
    expect(cleanupText({ lastRunAt: "2026-11-24T18:00:00.000Z", deletedCount: 312 }, "MMM d, yyyy", "12-hour")).toBe("Last cleanup Nov 25, 2026 at 2:00 AM removed 312 entries.");
    expect(cleanupText({ lastRunAt: "2026-11-24T18:00:00.000Z", deletedCount: 1 }, "MMM d, yyyy", "24-hour")).toBe("Last cleanup Nov 25, 2026 at 02:00 removed 1 entry.");
    expect(cleanupText({ lastRunAt: null, deletedCount: null }, "MMM d, yyyy", "12-hour")).toBe("No cleanup yet.");
    expect(lastChangedText("2026-11-12T02:00:00.000Z", "Carlo Mendoza", "MMM d, yyyy")).toBe("Last changed Nov 12, 2026 by Carlo Mendoza. Every change is recorded in Activity.");
    expect(lastChangedText(null, null, "MMM d, yyyy")).toBe("TANAW is using the default settings. Every change is recorded in Activity.");
  });
});
