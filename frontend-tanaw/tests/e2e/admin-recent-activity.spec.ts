// Admin Recent Activity: the flat activity list, pinned unresolved requests, filters, paging and the details drawer.
import { expect, test, type Page } from "@playwright/test";
import { json, mockEmptyCollections, mockPortalSession, portalUser, type PortalTheme } from "./support/session";

type Log = {
  id: string;
  timestamp: string;
  category: string;
  severity: string;
  actor: string;
  actorRole: string;
  action: string;
  target: string;
  summary: string;
  sourceId?: string;
  resolutionStatus?: "Unresolved" | "Resolved" | null;
  metadata?: Record<string, string | number | boolean | null>;
};

const log = (entry: Partial<Log> & Pick<Log, "id" | "timestamp" | "action" | "summary">): Log => ({
  category: "Admin Operation",
  severity: "Info",
  actor: "LGU Admin",
  actorRole: "Admin",
  target: "admin.e2e@example.test",
  ...entry,
});

// "Today" is Mon Nov 23, 2026 in Manila. Newest first after the pinned request.
const logs: Log[] = [
  log({ id: "old-sign-in", timestamp: "2026-10-20T02:00:00Z", action: "Login", summary: "LGU Admin signed in during October." }),
  log({
    id: "n9",
    timestamp: "2026-11-05T02:00:00Z",
    category: "IT Activity",
    actor: "Ana Reyes",
    actorRole: "IT Personnel",
    action: "Update System Settings",
    target: "TANAW",
    summary: "Ana Reyes updated the system settings.",
  }),
  log({
    id: "n8",
    timestamp: "2026-11-10T02:00:00Z",
    category: "Staff Operation",
    actor: "Ana Cruz",
    actorRole: "LGU Staff",
    action: "Password Changed",
    target: "ana.cruz@example.test",
    summary: "Ana Cruz changed her password.",
  }),
  log({ id: "n7", timestamp: "2026-11-15T02:00:00Z", action: "Logout", summary: "LGU Admin signed out of TANAW." }),
  log({
    id: "n6",
    timestamp: "2026-11-18T05:00:00Z",
    category: "Staff Operation",
    actor: "Maria Santos",
    actorRole: "LGU Staff",
    action: "Notify Enterprise",
    target: "Casa San Pedro",
    summary: "Maria Santos notified Casa San Pedro: Please send your report.",
  }),
  log({
    id: "n5",
    timestamp: "2026-11-19T02:00:00Z",
    category: "Enterprise Activity",
    severity: "Warning",
    actor: "Riverside Food Park",
    actorRole: "Enterprise Account",
    action: "Submit Support Ticket",
    target: "TCK-2026-0042",
    summary: "Riverside Food Park submitted TCK-2026-0042: Owner cannot sign in.",
    sourceId: "ticket-42",
    resolutionStatus: "Resolved",
    metadata: { category: "Account and access", priority: "High", attachmentCount: 0 },
  }),
  log({
    id: "n4",
    timestamp: "2026-11-20T08:15:00Z",
    category: "IT Activity",
    severity: "Success",
    actor: "Carlo Mendoza",
    actorRole: "IT Personnel",
    action: "Create Enterprise Account",
    target: "Laguna Lakeside Resort",
    summary: "Carlo Mendoza created an enterprise account for Laguna Lakeside Resort.",
    metadata: { enterpriseId: "ENT-3", barangay: "Landayan" },
  }),
  log({
    id: "n3",
    timestamp: "2026-11-21T03:00:00Z",
    category: "Staff Submission",
    severity: "Success",
    actor: "Casa San Pedro",
    actorRole: "Enterprise Account",
    action: "Submit Enterprise Report",
    target: "Casa San Pedro",
    summary: "Casa San Pedro submitted RPT-2026-10-001 for October 2026.",
    sourceId: "report-1",
    metadata: { enterpriseId: "ENT-1", period: "October 2026", uniqueCount: 1250 },
  }),
  log({
    id: "n2",
    timestamp: "2026-11-22T06:40:00Z",
    category: "Staff Operation",
    severity: "Warning",
    actor: "Maria Santos",
    actorRole: "LGU Staff",
    action: "Report Returned",
    target: "Pacita Complex Mall",
    summary: "Maria Santos marked RPT-2026-10-008 from Pacita Complex Mall as Returned.",
    sourceId: "report-8",
    metadata: { enterpriseId: "ENT-2", period: "October 2026", remarks: "Visitor origins need correcting" },
  }),
  log({ id: "n1", timestamp: "2026-11-23T01:30:00Z", action: "Login", summary: "LGU Admin signed in to TANAW." }),
  log({
    id: "pinned",
    timestamp: "2026-09-15T01:00:00Z",
    category: "Enterprise Activity",
    severity: "Warning",
    actor: "Municipal Sports Center",
    actorRole: "Enterprise Account",
    action: "Desktop Application Problem",
    target: "Municipal Sports Center",
    summary: "Municipal Sports Center reported a desktop application problem: the app closes on start-up.",
    sourceId: "alert-77",
    resolutionStatus: "Unresolved",
    metadata: { enterpriseId: "ENT-9", status: "New" },
  }),
];

async function openRecentActivity(page: Page, path = "/admin/activity", theme: PortalTheme = "light") {
  await page.clock.setFixedTime(new Date("2026-11-23T10:00:00+08:00"));
  await mockPortalSession(page, portalUser("admin"), { theme });
  await mockEmptyCollections(page, ["**/operational/notifications", "**/operational/alerts", "**/operational/tickets", "**/accounts/enterprises"]);
  await page.route("**/activity-logs", (route) => route.fulfill(json(logs)));
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Recent Activity" })).toBeVisible();
}

const rows = (page: Page) => page.locator("[data-activity-row]");
const summary = (page: Page) => page.getByRole("status").filter({ hasText: "unresolved pinned" });

test("lists activity newest first with unresolved requests pinned, eight per page", async ({ page }) => {
  await openRecentActivity(page);

  await expect(page.getByRole("main").getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/admin/dashboard");
  await expect(summary(page)).toHaveText("All activity · 10 records · 1 unresolved pinned · Nov 1 – 23, 2026");
  await expect(page.getByRole("combobox", { name: "Activity type" })).toContainText("All Activities");

  await expect(rows(page)).toHaveCount(8);
  const pinned = rows(page).first();
  await expect(pinned).toHaveAttribute("data-pinned", "true");
  await expect(pinned).toContainText("Desktop App Problem Reported");
  await expect(pinned).toContainText("Help request");
  await expect(pinned).toContainText("Unresolved");
  await expect(pinned).toContainText("Sep 15, 2026");
  await expect(rows(page).nth(1)).toContainText("Signed In");
  await expect(rows(page).nth(1)).toContainText("9:30 AM");
  await expect(page.getByText("LGU Admin signed in during October.")).toHaveCount(0);

  const pages = page.getByRole("navigation", { name: "Activity pages" });
  await expect(pages).toContainText("Showing 1–8 of 10");
  await pages.getByRole("button", { name: "Page 2" }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(pages).toContainText("Showing 9–10 of 10");
  await expect(rows(page).first()).toContainText("Password Changed");
});

test("filters by activity type, search and date range, and resets with Show all activity", async ({ page }) => {
  await openRecentActivity(page);

  await page.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: /Help Requests/ }).click();
  await expect(summary(page)).toHaveText("Help Requests · 2 records · 1 unresolved pinned · Nov 1 – 23, 2026");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText("Support Request Sent");

  await page.getByRole("button", { name: "Show all activity" }).click();
  await expect(rows(page)).toHaveCount(8);

  await page.getByRole("searchbox", { name: "Search activity, person, or enterprise" }).fill("pacita");
  await expect(summary(page)).toContainText("1 matching record");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Report Sent Back for Correction");
  await page.getByRole("button", { name: "Show all activity" }).first().click();

  await page.getByRole("button", { name: "November 2026" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a date range for Recent Activity" });
  await picker.getByRole("button", { name: "Today", exact: true }).click();
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(summary(page)).toHaveText("All activity · 2 records · 1 unresolved pinned · Nov 23, 2026");
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole("combobox", { name: "Activity type" }).click();
  await page.getByRole("option", { name: /Account Changes/ }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("No account changes for Nov 23, 2026.")).toBeVisible();
});

test("opens an activity in the details drawer, keeps it in the URL and steps through the list", async ({ page }) => {
  await openRecentActivity(page);

  const pinnedRow = rows(page).first();
  await pinnedRow.click();
  const drawer = page.getByRole("dialog", { name: "Desktop App Problem Reported" });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/activity\?activity=pinned$/);
  await expect(pinnedRow).toHaveAttribute("aria-expanded", "true");
  await expect(drawer).toContainText(/Unresolved, open \d+ days/);
  await expect(drawer).toContainText("Sep 15, 2026 at 9:00 AM · ACT-PINNED");
  await expect(drawer).toContainText("Municipal Sports Center");
  await expect(drawer.getByText("Not resolved yet")).toBeVisible();
  await expect(drawer.getByRole("link", { name: "View details" })).toHaveAttribute("href", "/admin/requests?alert=alert-77");
  await expect(drawer.getByRole("link", { name: "Open enterprise details" })).toHaveAttribute("href", "/admin/enterprises/ENT-9");
  await expect(drawer).toContainText("1 of 10");

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/activity$/);
  await expect(pinnedRow).toBeFocused();

  await rows(page).nth(7).click();
  const signedOut = page.getByRole("dialog", { name: "Signed Out" });
  await expect(signedOut).toContainText("8 of 10");
  await signedOut.getByRole("button", { name: "Next activity" }).click();
  const passwordChanged = page.getByRole("dialog", { name: "Password Changed" });
  await expect(passwordChanged).toContainText("9 of 10");
  await expect(page.getByRole("navigation", { name: "Activity pages" }).getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/activity=n8$/);

  await passwordChanged.getByRole("button", { name: "Close activity details" }).click();
  await expect(rows(page).first()).toBeFocused();
});

test("opens a linked activity on its page with links to the report and enterprise", async ({ page }) => {
  await openRecentActivity(page, "/admin/activity?activity=n3", "dark");

  const drawer = page.getByRole("dialog", { name: "Report Submitted" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Casa San Pedro");
  await expect(drawer).toContainText("October 2026");
  await expect(drawer).toContainText("1,250");
  await expect(drawer.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Open Enterprise Reports" })).toHaveAttribute("href", "/admin/reports?enterprise=ENT-1&month=October&year=2026");
  await expect(drawer.getByRole("link", { name: "Open enterprise details" })).toHaveAttribute("href", "/admin/enterprises/ENT-1");

  await drawer.getByRole("button", { name: "Previous activity" }).click();
  await expect(page.getByRole("dialog", { name: "Report Sent Back for Correction" })).toContainText("Reviewing");

  await page.locator(".tanaw-activity-drawer__scrim").click({ position: { x: 20, y: 200 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
