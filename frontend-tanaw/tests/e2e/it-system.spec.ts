// IT System: the Activity tab with technical detail, the Email log with Try again, and the Settings form.
import { expect, test, type Page } from "@playwright/test";
import type { components } from "../../src/contracts/generated/api";
import { json, mockPortalSession, portalUser, type PortalTheme } from "./support/session";

type Schemas = components["schemas"];
type Log = Schemas["ActivityLogSummary"];
type Email = Schemas["EmailDeliverySummary"];
type SettingValues = Record<string, string | number | boolean>;

// 2:30 PM on Thu Nov 26, 2026 in Manila.
const NOW = new Date("2026-11-26T06:30:00Z");
const itUser = portalUser("it", { id: "it-ana", displayName: "Ana Reyes", firstName: "Ana", lastName: "Reyes" });
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const log = (entry: Partial<Log> & Pick<Log, "id" | "timestamp" | "action" | "summary">): Log => ({
  group: "Login & Security",
  severity: "Info",
  actor: "Ana Reyes",
  actorRole: "IT Personnel",
  target: "ana@example.test",
  itDetail: null,
  sourceId: null,
  metadata: null,
  technical: null,
  ...entry,
});

const logs: Log[] = [
  log({
    id: "reply",
    timestamp: "2026-11-26T06:10:00Z",
    group: "Requests",
    action: "Reply to Request",
    target: "REQ-000149",
    summary: "Ana Reyes replied to REQ-000149.",
    sourceId: "request-149",
    metadata: { requestCode: "REQ-000149" },
    technical: { ipAddress: "10.12.4.21", userAgent: CHROME, sessionId: "ses_8f2c41ad" },
  }),
  log({
    id: "camera",
    timestamp: "2026-11-26T05:24:00Z",
    group: "Monitoring",
    severity: "Warning",
    actor: "TANAW",
    actorRole: "System",
    action: "Camera Stopped Counting",
    target: "San Antonio Lakeside Park",
    summary: "The Gate A camera at San Antonio Lakeside Park stopped counting.",
    itDetail: "Camera: Gate A · Error: STREAM_TIMEOUT after 3 retries",
  }),
  log({
    id: "invite",
    timestamp: "2026-11-25T08:05:00Z",
    group: "Enterprises",
    action: "Resend Account Activation",
    target: "San Pedro Heritage Museum",
    summary: "Ana Reyes resent the activation email to San Pedro Heritage Museum.",
    metadata: { enterpriseId: "ENT-12" },
    technical: { ipAddress: "10.12.4.18", userAgent: null, sessionId: null },
  }),
  log({ id: "staff", timestamp: "2026-11-22T01:14:00Z", group: "Accounts", action: "Create LGU Account", target: "Grace Bautista", summary: "Ana Reyes invited Grace Bautista as Staff." }),
  // Older sign-ins, enough to need "Show more".
  ...Array.from({ length: 30 }, (_, index) =>
    log({ id: `sign-in-${index}`, timestamp: new Date(Date.UTC(2026, 10, 20, 12) - index * 3_600_000).toISOString(), action: "Login", summary: `Sign-in number ${index}.` }),
  ),
];

const email = (entry: Partial<Email> & Pick<Email, "id" | "recipient" | "purpose" | "status" | "createdAt">): Email => ({
  provider: "brevo",
  attemptCount: 1,
  maxAttempts: 5,
  manualRetryCount: 0,
  nextAttemptAt: null,
  providerMessageId: null,
  errorCode: null,
  failureReason: null,
  outcomeUncertain: false,
  canRetry: false,
  acceptedAt: null,
  accountId: null,
  recipientName: null,
  recipientRole: null,
  ...entry,
});

const emails: Email[] = [
  email({
    id: "reply-mail",
    recipient: "frontdesk@lakeside.example",
    purpose: "request_reply",
    status: "accepted",
    createdAt: "2026-11-26T05:41:00Z",
    recipientName: "Laguna Lakeside Resort",
    recipientRole: "Enterprise Account",
  }),
  email({
    id: "bounced",
    recipient: "museum@sanpedro.example",
    purpose: "account_activation",
    status: "terminal_failed",
    failureReason: "The mailbox is full",
    canRetry: true,
    createdAt: "2026-11-25T08:05:00Z",
    recipientName: "San Pedro Heritage Museum",
    recipientRole: "Enterprise Account",
  }),
  email({
    id: "staff-invite",
    recipient: "grace@sanpedro.example",
    purpose: "account_activation",
    status: "queued",
    createdAt: "2026-11-22T01:14:00Z",
    recipientName: "Grace Bautista",
    recipientRole: "LGU Staff",
  }),
];

type Mocks = { patches: SettingValues[]; calls: string[]; values: SettingValues };

async function openSystem(page: Page, path = "/it/system", options: { theme?: PortalTheme; viewport?: { width: number; height: number } } = {}): Promise<Mocks> {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 1000 });
  await mockPortalSession(page, itUser, { theme: options.theme });
  const mocks: Mocks = {
    patches: [],
    calls: [],
    values: {
      "security.loginAttemptLimit": 5,
      "security.loginLockMinutes": 15,
      "monitoring.cameraWaitMinutes": 15,
      "logs.retentionDays": 180,
      "display.dateFormat": "MMM d, yyyy",
      "display.timeFormat": "12-hour",
    },
  };
  let deliveries = [...emails];
  let cleanup: Schemas["ActivityLogCleanupStatus"] = { lastRunAt: "2026-11-25T18:00:00Z", deletedCount: 312, retentionDays: 180 };

  for (const endpoint of ["**/operational/notifications", "**/operational/alerts", "**/operational/requests", "**/operational/enterprise-health", "**/accounts/enterprises", "**/accounts/lgu"]) {
    await page.route(endpoint, (route) => route.fulfill(json([])));
  }
  await page.route(/\/activity-logs(\?.*)?$/, (route) => route.fulfill(json(logs)));
  await page.route(/\/activity-logs\/cleanup$/, (route) => route.fulfill(json(cleanup)));
  await page.route(/\/activity-logs\/purge-expired$/, (route) => {
    mocks.calls.push("purge");
    cleanup = { lastRunAt: NOW.toISOString(), deletedCount: 4, retentionDays: 180 };
    return route.fulfill(json({ deletedCount: 4, retentionDays: 180 }));
  });
  await page.route(/\/mail\/deliveries(\?.*)?$/, (route) => {
    mocks.calls.push(`emails ${new URL(route.request().url()).searchParams.get("sinceDays")}`);
    return route.fulfill(json(deliveries));
  });
  await page.route(/\/mail\/deliveries\/[^/]+\/retry$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    mocks.calls.push(`retry ${id}`);
    deliveries = deliveries.map((item) => (item.id === id ? { ...item, status: "queued", canRetry: false, manualRetryCount: 1, failureReason: null } : item));
    return route.fulfill(json(deliveries.find((item) => item.id === id)));
  });
  await page.route("**/auth/system-settings", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = (await route.request().postDataJSON()).values as SettingValues;
      mocks.patches.push(patch);
      mocks.values = { ...mocks.values, ...patch };
      return route.fulfill(json({ values: mocks.values, updatedBy: itUser.displayName, updatedAt: NOW.toISOString() }));
    }
    return route.fulfill(json({ values: mocks.values, updatedBy: "Carlo Mendoza", updatedAt: "2026-11-12T02:00:00Z" }));
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  return mocks;
}

const rows = (page: Page) => page.locator("[data-activity-row]");
const row = (page: Page, id: string) => page.locator(`[data-activity-row="${id}"]`);

test("lists activity newest first by type, and opens a row's technical detail", async ({ page }) => {
  await openSystem(page);

  await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Newest first. Entries never change. Select one to see the technical detail.")).toBeVisible();
  await expect(rows(page)).toHaveCount(25);
  await expect(rows(page).first()).toContainText("Today");
  await expect(rows(page).first()).toContainText("2:10 PM");
  await expect(rows(page).first()).toContainText("Reply Sent");
  await expect(rows(page).first()).toContainText("Ana Reyes");
  await expect(rows(page).first()).toContainText("IT");
  await expect(rows(page).first()).toContainText("Requests");
  await expect(row(page, "camera")).toContainText("System");
  await expect(row(page, "invite")).toContainText("Yesterday");
  await expect(row(page, "invite")).toContainText("Enterprises");

  await page.getByRole("button", { name: "Show 9 more" }).click();
  await expect(rows(page)).toHaveCount(34);
  await expect(page.getByText("Showing 34 of 34 entries")).toBeVisible();

  const types = page.getByRole("radiogroup", { name: "Activity type" });
  await types.getByRole("radio", { name: "Enterprises" }).click();
  await expect(rows(page)).toHaveCount(1);
  await types.getByRole("radio", { name: "System" }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Camera Stopped Counting");
  await types.getByRole("radio", { name: "Sign-in and security" }).click();
  await expect(rows(page)).toHaveCount(25);
  await types.getByRole("radio", { name: "All" }).click();

  await row(page, "reply").click();
  await expect(row(page, "reply")).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/activity=reply/);
  const detail = page.getByRole("region", { name: "Technical detail: Reply to Request" });
  await expect(detail).toContainText("10.12.4.21");
  await expect(detail).toContainText("Chrome 131 on Windows");
  await expect(detail).toContainText("ses_8f2c41ad");
  await expect(detail).toContainText("REQ-000149");
  await expect(detail.getByRole("link", { name: "Open the request" })).toHaveAttribute("href", "/it/requests?request=request-149");

  await row(page, "reply").click();
  await expect(row(page, "reply")).toHaveAttribute("aria-expanded", "false");
  await expect(page).not.toHaveURL(/activity=/);
});

test("opens a linked activity with its IT detail", async ({ page }) => {
  await openSystem(page, "/it/system?tab=activity&activity=camera", { theme: "dark" });

  await expect(row(page, "camera")).toHaveAttribute("aria-expanded", "true");
  const detail = page.getByRole("region", { name: "Technical detail: Camera Stopped Counting" });
  await expect(detail).toContainText("STREAM_TIMEOUT after 3 retries");
  await expect(detail).toContainText("TANAW itself, not a browser");
  await expect(detail.getByRole("link", { name: "Open the Overview" })).toHaveAttribute("href", "/it/dashboard");
});

test("shows the last 7 days of email and tries a failed one again", async ({ page }) => {
  const mocks = await openSystem(page, "/it/system?tab=email");

  const emailTab = page.getByRole("tab", { name: /^Email log/ });
  await expect(emailTab).toHaveAttribute("aria-selected", "true");
  await expect(emailTab).toContainText("1");
  expect(mocks.calls).toContain("emails 7");
  await expect(page.getByText("Every email TANAW sent in the last 7 days.")).toBeVisible();

  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(4);
  const bounced = table.getByRole("row", { name: /museum@sanpedro.example/ });
  await expect(bounced).toContainText("San Pedro Heritage Museum, Enterprise");
  await expect(bounced).toContainText("Sign-in invitation");
  await expect(bounced).toContainText("Not delivered");
  await expect(bounced).toContainText("The mailbox is full");
  await expect(table.getByRole("row", { name: /frontdesk@lakeside.example/ })).toContainText("Delivered");
  await expect(table.getByRole("row", { name: /grace@sanpedro.example/ })).toContainText("Sending");

  await page
    .getByRole("radiogroup", { name: "Email result" })
    .getByRole("radio", { name: /Problems only/ })
    .click();
  await expect(table.getByRole("row")).toHaveCount(2);

  await bounced.getByRole("button", { name: /Try again/ }).click();
  await expect.poll(() => mocks.calls).toContain("retry bounced");
  await expect(page.getByText("No email problems")).toBeVisible();
  await expect(emailTab).not.toContainText("1");
});

test("saves the settings in one form, asks before a lockout change, and removes older activity", async ({ page }) => {
  const mocks = await openSystem(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page).toHaveURL(/tab=settings/);

  await expect(page.getByText("Last changed Nov 12, 2026 by Carlo Mendoza. Every change is recorded in Activity.")).toBeVisible();
  await expect(page.getByText("Last cleanup Nov 26, 2026 at 2:00 AM removed 312 entries.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);

  // Retention and date format change together, and only they are sent.
  await page.getByRole("radiogroup", { name: "Keep activity for" }).getByRole("radio", { name: "1 year" }).click();
  await page.getByRole("combobox", { name: "Date" }).click();
  await page.getByRole("option", { name: "2026-11-26" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect.poll(() => mocks.patches).toEqual([{ "logs.retentionDays": 365, "display.dateFormat": "yyyy-MM-dd" }]);
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  await expect(page.getByText("Last changed 2026-11-26 by Ana Reyes.")).toBeVisible();

  // A lockout change asks first.
  await page.getByRole("combobox", { name: "Wrong passwords before an account locks" }).click();
  await page.getByRole("option", { name: "10" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  const confirm = page.getByRole("dialog", { name: "Change the sign-in lockout?" });
  await expect(confirm).toContainText("lock after 10 wrong passwords, for 15 minutes");
  await confirm.getByRole("button", { name: "Save settings" }).click();
  await expect.poll(() => mocks.patches.at(-1)).toEqual({ "security.loginAttemptLimit": 10 });

  // Remove older activity now, with a confirmation.
  await page.getByRole("button", { name: "Remove older activity now" }).click();
  const remove = page.getByRole("dialog", { name: "Remove older activity now?" });
  await expect(remove).toContainText("older than 1 year");
  await remove.getByRole("button", { name: "Remove older activity" }).click();
  await expect.poll(() => mocks.calls).toContain("purge");
  await expect(page.getByText("Last cleanup 2026-11-26 at 2:30 PM removed 4 entries.")).toBeVisible();
});

test("discards settings edits and fits a phone in dark mode", async ({ page }) => {
  await openSystem(page, "/it/system?tab=settings", { theme: "dark", viewport: { width: 375, height: 812 } });

  await page.getByRole("combobox", { name: "Minutes without data before a camera is flagged" }).click();
  await page.getByRole("option", { name: "30" }).click();
  await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Minutes without data before a camera is flagged" })).toContainText("15");

  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(rows(page).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
