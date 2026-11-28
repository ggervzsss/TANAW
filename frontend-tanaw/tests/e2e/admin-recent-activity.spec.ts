// Admin Recent Activity: every record newest first in seven groups, the busy places pinned above them, filters, paging and the details drawer.
// IT reads the same records on the System screen (it-system.spec.ts).
import { expect, test, type Page } from "@playwright/test";
import { json, mockEmptyCollections, mockPortalSession, portalUser, type PortalTheme } from "./support/session";

type Log = {
  id: string;
  timestamp: string;
  group: string;
  severity: string;
  actor: string;
  actorRole: string;
  action: string;
  target: string;
  summary: string;
  sourceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

const log = (entry: Partial<Log> & Pick<Log, "id" | "timestamp" | "action" | "summary">): Log => ({
  group: "Login & Security",
  severity: "Info",
  actor: "LGU Admin",
  actorRole: "Admin",
  target: "admin.e2e@example.test",
  ...entry,
});

// "Today" is Mon Nov 23, 2026 in Manila.
const logs: Log[] = [
  log({ id: "old-sign-in", timestamp: "2026-10-20T02:00:00Z", action: "Login", summary: "LGU Admin signed in during October." }),
  log({ id: "n9", timestamp: "2026-11-05T02:00:00Z", group: "Settings & Maintenance", actor: "Ana Reyes", actorRole: "IT Personnel", action: "Update System Settings", target: "TANAW", summary: "Ana Reyes updated the system settings." }),
  log({ id: "n8", timestamp: "2026-11-10T02:00:00Z", actor: "Ana Cruz", actorRole: "LGU Staff", action: "Password Changed", target: "ana.cruz@example.test", summary: "Ana Cruz changed her password." }),
  log({ id: "n7", timestamp: "2026-11-15T02:00:00Z", action: "Logout", summary: "LGU Admin signed out of TANAW." }),
  log({ id: "n6", timestamp: "2026-11-18T05:00:00Z", group: "Reports", actor: "Maria Santos", actorRole: "LGU Staff", action: "Notify Enterprise", target: "Casa San Pedro", summary: "Maria Santos notified Casa San Pedro: Please send your report." }),
  log({
    id: "n5",
    timestamp: "2026-11-19T02:00:00Z",
    group: "Requests",
    actor: "Riverside Food Park",
    actorRole: "Enterprise Account",
    action: "Send Request",
    target: "REQ-000042",
    summary: "Riverside Food Park sent a request: Owner cannot sign in.",
    sourceId: "request-42",
    metadata: { requestCode: "REQ-000042", requestGroup: "Other" },
  }),
  log({ id: "n4", timestamp: "2026-11-20T08:15:00Z", group: "Accounts", severity: "Success", actor: "Carlo Mendoza", actorRole: "IT Personnel", action: "Create Enterprise Account", target: "Laguna Lakeside Resort", summary: "Carlo Mendoza registered enterprise account Laguna Lakeside Resort and sent the activation email.", metadata: { enterpriseId: "ENT-3", barangay: "Landayan" } }),
  log({ id: "n3", timestamp: "2026-11-21T03:00:00Z", group: "Reports", severity: "Success", actor: "Casa San Pedro", actorRole: "Enterprise Account", action: "Submit Enterprise Report", target: "Casa San Pedro", summary: "Casa San Pedro submitted RPT-2026-10-001 for October 2026.", sourceId: "report-1", metadata: { enterpriseId: "ENT-1", period: "October 2026", uniqueCount: 1250 } }),
  log({ id: "n2", timestamp: "2026-11-22T06:40:00Z", group: "Reports", severity: "Success", actor: "Maria Santos", actorRole: "LGU Staff", action: "Report Ready to Consolidate", target: "Pacita Complex Mall", summary: "Maria Santos marked RPT-2026-10-008 from Pacita Complex Mall as Ready to Consolidate.", sourceId: "report-8", metadata: { enterpriseId: "ENT-2", period: "October 2026", remarks: "Totals checked against the gate counts" } }),
  log({
    id: "camera",
    timestamp: "2026-11-22T23:00:00Z",
    group: "Monitoring",
    severity: "Warning",
    actor: "TANAW",
    actorRole: "System",
    action: "Camera Stopped Counting",
    target: "Municipal Sports Center",
    summary: "The Gate A camera at Municipal Sports Center is not counting.",
  }),
  log({ id: "n1", timestamp: "2026-11-23T01:30:00Z", action: "Login", summary: "LGU Admin signed in to TANAW." }),
];

const liveAlert = (entry: { id: string; type: string; enterpriseId: string; enterpriseName: string; summary: string; startedAt: string; camera?: string }) => ({
  severity: entry.type === "Camera Not Counting" ? "Critical" : "Warning",
  status: "Active",
  camera: null,
  detail: null,
  endedAt: null,
  ...entry,
});

// Two places busier than usual right now, and a camera alert that is not pinned.
const busyAlerts = [
  liveAlert({ id: "ALT-000011", type: "Busier Than Usual", enterpriseId: "ENT-2", enterpriseName: "Pacita Complex Mall", summary: "Pacita Complex Mall has 210 visitors inside, more than its usual 120 around this time.", startedAt: "2026-11-23T00:40:00Z" }),
  liveAlert({ id: "ALT-000010", type: "Busier Than Usual", enterpriseId: "ENT-7", enterpriseName: "San Antonio Plaza", summary: "San Antonio Plaza has 60 visitors inside, more than its usual 43 around this time.", startedAt: "2026-11-23T01:15:00Z" }),
  liveAlert({ id: "ALT-000012", type: "Camera Not Counting", enterpriseId: "ENT-9", enterpriseName: "Municipal Sports Center", camera: "Gate A", summary: "The Gate A camera at Municipal Sports Center is not counting.", startedAt: "2026-11-22T23:00:00Z" }),
];

async function openActivity(page: Page, path = "/admin/activity", theme: PortalTheme = "light", alerts: unknown[] = []) {
  await page.clock.setFixedTime(new Date("2026-11-23T10:00:00+08:00"));
  await mockPortalSession(page, portalUser("admin"), { theme });
  await mockEmptyCollections(page, ["**/operational/notifications", "**/operational/alerts", "**/operational/requests", "**/accounts/enterprises"]);
  // Registered after the empty collections, so it takes precedence.
  if (alerts.length) await page.route("**/operational/alerts", (route) => route.fulfill(json(alerts)));
  await page.route("**/activity-logs", (route) => route.fulfill(json(logs)));
  await page.goto(path);
}

const rows = (page: Page) => page.locator("[data-activity-row]");
const pinnedRows = (page: Page) => page.locator("[data-pinned]");
const summary = (page: Page) => page.getByRole("status").filter({ hasText: / records? · / });

test("lists every record newest first in groups, eight per page, with nothing pinned", async ({ page }) => {
  await openActivity(page);
  await expect(page.getByRole("heading", { level: 1, name: "Recent Activity" })).toBeVisible();

  await expect(page.getByRole("main").getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/admin/dashboard");
  await expect(summary(page)).toHaveText("All activity · 10 records · Nov 1 – 23, 2026");
  await expect(page.getByText("unresolved pinned")).toHaveCount(0);
  await expect(page.locator("[data-pinned]")).toHaveCount(0);

  await expect(rows(page)).toHaveCount(8);
  await expect(rows(page).first()).toContainText("Signed In");
  await expect(rows(page).first()).toContainText("Login & security");
  await expect(rows(page).nth(1)).toContainText("Camera Stopped Counting");
  await expect(rows(page).nth(1)).toContainText("Monitoring");
  await expect(page.getByText("LGU Admin signed in during October.")).toHaveCount(0);

  const pages = page.getByRole("navigation", { name: "Activity pages" });
  await expect(pages).toContainText("Showing 1–8 of 10");
  await pages.getByRole("button", { name: "Page 2" }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Password Changed");
});

test("filters by group, search and date range, and resets with Show all activity", async ({ page }) => {
  await openActivity(page);

  await page.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: /^Requests/ }).click();
  await expect(summary(page)).toHaveText("Requests · 1 record · Nov 1 – 23, 2026");
  await expect(rows(page).first()).toContainText("Request Sent");

  await page.getByRole("button", { name: "Show all activity" }).first().click();
  await expect(rows(page)).toHaveCount(8);

  await page.getByRole("searchbox", { name: "Search activity, person, or enterprise" }).fill("pacita");
  await expect(summary(page)).toContainText("1 matching record");
  await expect(rows(page).first()).toContainText("Report Review Completed");
  await page.getByRole("button", { name: "Show all activity" }).first().click();

  await page.getByRole("button", { name: "November 2026" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a date range for Recent Activity" });
  await picker.getByRole("button", { name: "Today", exact: true }).click();
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(summary(page)).toHaveText("All activity · 2 records · Nov 23, 2026");

  await page.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: /^Accounts/ }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("No accounts for Nov 23, 2026.")).toBeVisible();
});

test("pins each place busier than usual right now above the records, under All Activity and Busiest Enterprises", async ({ page }) => {
  await openActivity(page, "/admin/activity", "light", busyAlerts);

  // One amber row per busy place, most recently busy first; the camera alert is not pinned.
  await expect(pinnedRows(page)).toHaveCount(2);
  await expect(summary(page)).toHaveText("All activity · 10 records · 2 busy enterprises pinned · Nov 1 – 23, 2026");
  const plaza = pinnedRows(page).first();
  await expect(plaza).toContainText("Nov 23, 2026");
  await expect(plaza).toContainText("Since 9:15 AM");
  await expect(plaza).toContainText("Busier than usual");
  await expect(plaza).toContainText("Busiest enterprises");
  await expect(plaza).toContainText("Still busy");
  await expect(plaza).toContainText("San Antonio Plaza");
  await expect(plaza).toContainText("more than its usual 43 around this time.");
  await expect(plaza.getByRole("link")).toHaveAttribute("href", "/admin/dashboard?place=ENT-7");
  await expect(pinnedRows(page).nth(1)).toContainText("Pacita Complex Mall");
  await expect(pinnedRows(page).filter({ hasText: "Municipal Sports Center" })).toHaveCount(0);

  // Pinned rows are not records: the records still page eight at a time, and the pins stay on page 1.
  await expect(rows(page)).toHaveCount(8);
  const pages = page.getByRole("navigation", { name: "Activity pages" });
  await expect(pages).toContainText("Showing 1–8 of 10");
  await pages.getByRole("button", { name: "Page 2" }).click();
  await expect(pinnedRows(page)).toHaveCount(0);
  await pages.getByRole("button", { name: "Page 1" }).click();
  await expect(pinnedRows(page)).toHaveCount(2);

  // Other types hide them; Busiest Enterprises keeps them.
  await page.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: /^Monitoring/ }).click();
  await expect(pinnedRows(page)).toHaveCount(0);
  await expect(summary(page)).toHaveText("Monitoring · 1 record · Nov 1 – 23, 2026");

  await page.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: /^Busiest Enterprises/ }).click();
  await expect(pinnedRows(page)).toHaveCount(2);
  await expect(summary(page)).toHaveText("Busiest Enterprises · 0 records · 2 busy enterprises pinned · Nov 1 – 23, 2026");
  await expect(page.getByText("No busy-place records for Nov 1 – 23, 2026.")).toBeVisible();

  // The search matches a pinned row by its enterprise name.
  await page.getByRole("searchbox", { name: "Search activity, person, or enterprise" }).fill("pacita");
  await expect(pinnedRows(page)).toHaveCount(1);
  await expect(pinnedRows(page).first()).toContainText("Pacita Complex Mall");
  await expect(summary(page)).toHaveText("Busiest Enterprises · 0 matching records · 1 busy enterprise pinned · Nov 1 – 23, 2026");

  // A pinned row opens the place on the Dashboard map, not the details drawer.
  await pinnedRows(page).first().getByRole("link").press("Enter");
  await expect(page).toHaveURL(/\/admin\/dashboard\?place=ENT-2/);
});

test("says so under Busiest Enterprises when no place is busy right now", async ({ page }) => {
  await openActivity(page);

  await page.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: /^Busiest Enterprises/ }).click();
  await expect(pinnedRows(page)).toHaveCount(0);
  await expect(summary(page)).toHaveText("Busiest Enterprises · 0 records · Nov 1 – 23, 2026");
  await expect(page.getByText("No place is busier than usual right now. No busy-place records for Nov 1 – 23, 2026.")).toBeVisible();
});

test("opens an activity in the drawer, keeps it in the URL, links to the request and steps through the list", async ({ page }) => {
  await openActivity(page);

  await page.getByRole("searchbox", { name: "Search activity, person, or enterprise" }).fill("Riverside");
  await rows(page).first().click();
  const drawer = page.getByRole("dialog", { name: "Request Sent" });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/activity=n5/);
  await expect(drawer).toContainText("Nov 19, 2026 at 10:00 AM · REQ-000042");
  await expect(drawer).toContainText("Other");
  await expect(drawer.getByRole("link", { name: "Open the request" })).toHaveAttribute("href", "/admin/requests?request=request-42");
  await expect(drawer.getByText("Technical details")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search activity, person, or enterprise" }).fill("");

  await rows(page).nth(7).click();
  const signedOut = page.getByRole("dialog", { name: "Signed Out" });
  await expect(signedOut).toContainText("8 of 10");
  await signedOut.getByRole("button", { name: "Next activity" }).click();
  await expect(page.getByRole("dialog", { name: "Password Changed" })).toContainText("9 of 10");
  await expect(page.getByRole("navigation", { name: "Activity pages" }).getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
});

test("opens a linked report activity with links to Enterprise Reports and the enterprise", async ({ page }) => {
  await openActivity(page, "/admin/activity?activity=n3", "dark");

  const drawer = page.getByRole("dialog", { name: "Report Submitted" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("October 2026");
  await expect(drawer).toContainText("1,250");
  await expect(drawer.getByRole("link", { name: "Open Enterprise Reports" })).toHaveAttribute("href", "/admin/reports?enterprise=ENT-1&month=October&year=2026");
  await expect(drawer.getByRole("link", { name: "Open enterprise details" })).toHaveAttribute("href", "/admin/enterprises/ENT-1");

  await page.locator(".tanaw-activity-drawer__scrim").click({ position: { x: 20, y: 200 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
