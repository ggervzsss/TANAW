// Admin Enterprise Reports: the monthly report list, its filters, and the per-enterprise report details.
import { expect, test, type Page } from "@playwright/test";
import { json, mockPortalSession, portalUser, waitForStillPage, type PortalTheme } from "./support/session";

// Due dates are local calendar days in San Pedro, Laguna.
test.use({ timezoneId: "Asia/Manila" });

const admin = portalUser("admin", { id: "admin-enterprise-reports", email: "admin.reports@example.test" });
const attraction = { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const enterprises = [
  { id: "market", name: "San Pedro Public Market", category: "Public Market", barangay: "Poblacion", complianceOwner: "Edwin Ramos" },
  { id: "resort", name: "Laguna Lakeside Resort", category: "Resort", barangay: "Landayan", complianceOwner: "Rosa Lim" },
  { id: "museum", name: "Cuyab Heritage Museum", category: "Museum", barangay: "Cuyab", complianceOwner: "Ben Tan" },
  { id: "newcomer", name: "Bagong Park", category: "Park", barangay: "Narra", complianceOwner: "Ana Cruz" },
];

function account(enterpriseId: string, createdAt: string, managerName: string, phone: string) {
  return {
    id: `account-${enterpriseId}`,
    email: `${enterpriseId}@example.test`,
    phone,
    firstName: null,
    lastName: null,
    enterpriseName: enterpriseId,
    category: null,
    managerName,
    barangay: null,
    address: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId,
    gatewayStatus: null,
    buildingCapacity: 100,
    displayName: enterpriseId,
    role: "enterprise",
    title: "Enterprise",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt,
    lastLoginAt: null,
  };
}

const accounts = [
  account("market", "2026-01-05T09:00:00+08:00", "Edwin Ramos", "0917 555 0101"),
  account("resort", "2025-03-10T09:00:00+08:00", "Rosa Lim", "0917 555 0102"),
  account("museum", "2026-02-01T09:00:00+08:00", "Ben Tan", "0917 555 0103"),
  account("newcomer", "2026-11-15T09:00:00+08:00", "Ana Cruz", "0917 555 0104"),
];

function intake(enterpriseId: string, monthIndex: number, status: string, submittedAt: string, code: string) {
  const enterprise = enterprises.find((item) => item.id === enterpriseId)!;
  return {
    id: `${enterpriseId}-2026-${monthIndex + 1}`,
    enterpriseId,
    enterprise: enterprise.name,
    category: enterprise.category,
    attraction,
    barangay: enterprise.barangay,
    month: MONTHS[monthIndex],
    period: `${MONTHS[monthIndex]} 2026`,
    submitted: submittedAt,
    submittedAt,
    status,
    code,
    metrics: { entry: null, exit: null, unique: 40, peak: "12" },
  };
}

// The market sent every 2026 report except July; October is consolidated.
const marketReports = [0, 1, 2, 3, 4, 5, 7, 8].map((index) => intake("market", index, "Consolidated", `2026-${String(index + 2).padStart(2, "0")}-03T09:00:00+08:00`, `RPT-2026-${String(index + 1).padStart(2, "0")}-001`));
const reports = [
  ...marketReports,
  intake("market", 9, "Consolidated", "2026-11-01T08:30:00+08:00", "RPT-2026-10-001"),
  intake("museum", 9, "Pending Review", "2026-11-12T10:00:00+08:00", "RPT-2026-10-002"),
];

const logs = [
  {
    id: "log-review",
    timestamp: "2026-11-12T14:20:00+08:00",
    category: "Staff Operation",
    severity: "Success",
    actor: "Maria Santos",
    actorRole: "LGU Staff",
    action: "Report Ready to Consolidate",
    target: "San Pedro Public Market",
    summary: "Maria Santos marked RPT-2026-10-001 from San Pedro Public Market as Ready to Consolidate.",
    sourceId: "market-2026-10",
    metadata: { enterpriseId: "market", period: "October 2026", remarks: null },
  },
];

const finalReports = [
  {
    id: "CON-OCT-2026-0001",
    title: "Citywide Tourism Aggregation",
    period: "October 2026",
    generatedOn: "2026-11-21",
    preparedBy: "Jose Cruz",
    preparedRole: "Staff Processing Division",
    status: "Finalized",
    enterpriseCount: 1,
    totalEntry: null,
    totalExit: null,
    totalUnique: 40,
    sources: [{ id: "market-2026-10", enterpriseProfileId: "market-profile", enterprise: "San Pedro Public Market", attractionCode: "411", code: "RPT-2026-10-001", unique: 40, entry: null, exit: null }],
  },
];

const mapEnterprises = [
  {
    id: "market",
    name: "San Pedro Public Market",
    barangay: "Poblacion",
    category: "Public Market",
    fullAddress: "Poblacion, San Pedro, Laguna",
    lat: 14.36,
    lng: 121.06,
    totalLiveOccupancy: 10,
    estimatedUniqueCount: 40,
    monitoringStatus: "Fully Monitoring",
    occupancyStatus: "Normal",
    cameraMonitoring: { status: "running", configuredCameraCount: 6, activeCameraCount: 6, healthyCameraCount: 6, startingCameraCount: 0, stoppedCameraCount: 0, errorCameraCount: 0 },
  },
];

async function openEnterpriseReports(page: Page, path = "/admin/reports", theme: PortalTheme = "light") {
  // After the October due date (Nov 10), before the November one (Dec 10).
  await page.clock.setFixedTime(new Date("2026-11-24T10:00:00+08:00"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/operational/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/reports/enterprises")) return route.fulfill(json(enterprises));
    if (pathname.endsWith("/reports/intake")) return route.fulfill(json(reports));
    if (pathname.endsWith("/reports/final")) return route.fulfill(json(finalReports));
    if (pathname.endsWith("/map-enterprises")) return route.fulfill(json(mapEnterprises));
    return route.fulfill(json([]));
  });
  await page.route("**/activity-logs**", (route) => route.fulfill(json(logs)));
  await page.route("**/accounts/enterprises", (route) => route.fulfill(json(accounts)));
  await mockPortalSession(page, admin, { theme });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Enterprise Reports" })).toBeVisible();
}

const reportRows = (page: Page) => page.getByRole("list", { name: "Enterprise reports" }).getByRole("button");

test("lists each enterprise's report for the reporting month, missing first, with working filters", async ({ page }) => {
  await openEnterpriseReports(page);

  await expect(page.getByText("Who sent their October 2026 report, when it arrived, and where it is in review.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reporting month October 2026" })).toBeVisible();
  // Bagong Park registered in November, so it has no October report to send.
  await expect(page.getByText("3 of 3 enterprises", { exact: true })).toBeVisible();
  await expect(reportRows(page)).toHaveCount(3);
  await expect(reportRows(page).nth(0)).toContainText("Laguna Lakeside Resort");
  await expect(reportRows(page).nth(0)).toContainText("Landayan · No report yet");
  await expect(reportRows(page).nth(0)).toContainText("Not sent");
  await expect(reportRows(page).nth(0)).toContainText("14 days overdue");
  await expect(reportRows(page).nth(1)).toContainText("Cuyab Heritage Museum");
  // A late report shows only the day it was sent, without an "after due" note.
  await expect(reportRows(page).nth(1)).toContainText("Nov 12");
  await expect(reportRows(page).nth(1)).not.toContainText("after due");
  await expect(reportRows(page).nth(1)).toContainText("Not reviewed");
  await expect(reportRows(page).nth(2)).toContainText("San Pedro Public Market");
  await expect(reportRows(page).nth(2)).toContainText("Poblacion · RPT-2026-10-001");
  await expect(reportRows(page).nth(2)).toContainText("Consolidated");
  await expect(reportRows(page).nth(2)).toContainText("Maria Santos");
  await expect(page.getByText("Showing 3 of 3 enterprises", { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Submission status" }).click();
  await page.getByRole("option", { name: "Missing" }).click();
  await expect(page.getByText("1 of 3 enterprises", { exact: true })).toBeVisible();
  await expect(reportRows(page)).toHaveCount(1);
  await page.getByRole("combobox", { name: "Submission status" }).click();
  await page.getByRole("option", { name: "All statuses" }).click();

  await page.getByRole("searchbox", { name: "Search reports" }).fill("maria");
  await expect(reportRows(page)).toHaveCount(1);
  await expect(reportRows(page).first()).toContainText("San Pedro Public Market");
  await page.getByRole("searchbox", { name: "Search reports" }).fill("nothing like this");
  await expect(page.getByText("No reports match")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(reportRows(page)).toHaveCount(3);

  // The reporting month steps one month at a time, up to this month.
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page).toHaveURL(/month=November&year=2026/);
  await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
  await expect(page.getByText("4 of 4 enterprises", { exact: true })).toBeVisible();
  await expect(page.getByText("Due Dec 10")).toHaveCount(4);

  // Or jumps to any month since the first enterprise registered (Laguna Lakeside Resort, March 2025).
  await page.getByRole("button", { name: "Reporting month November 2026" }).click();
  const months = page.getByRole("dialog", { name: "Choose the reporting month" });
  await expect(months.getByRole("button", { name: /^October 2026/ })).toHaveAccessibleName("October 2026, Latest month due");
  await expect(months.getByRole("button", { name: "December 2026" })).toBeDisabled();
  await months.getByRole("button", { name: "Previous year" }).click();
  await expect(months.getByRole("button", { name: "Previous year" })).toBeDisabled();
  await expect(months.getByRole("button", { name: "February 2025" })).toBeDisabled();
  await months.getByRole("button", { name: "June 2025" }).click();
  await expect(months).toHaveCount(0);
  await expect(page).toHaveURL(/month=June&year=2025/);
  await expect(page.getByRole("button", { name: "Reporting month June 2025" })).toBeFocused();
  await expect(page.getByText("1 of 1 enterprise", { exact: true })).toBeVisible();
});

test("opens an enterprise's report details with its history and report log, and closes back to the list", async ({ page }, testInfo) => {
  await openEnterpriseReports(page);

  const marketRow = reportRows(page).filter({ hasText: "San Pedro Public Market" });
  await marketRow.click();
  await expect(page).toHaveURL(/enterprise=market&month=October&year=2026/);
  const dialog = page.getByRole("dialog", { name: "San Pedro Public Market" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Brgy. Poblacion, San Pedro, Laguna")).toBeVisible();
  await expect(dialog.getByText("Edwin Ramos")).toBeVisible();
  await expect(dialog.getByText("6, all monitoring")).toBeVisible();
  await expect(dialog.getByText("Jan 2026")).toBeVisible();
  await expect(dialog.getByText("October 2026 report")).toBeVisible();
  // Registered this year, so there is no other year to choose.
  await expect(dialog.getByRole("radiogroup", { name: "Year" })).toHaveCount(0);
  await expect(dialog.getByText("9 of 10", { exact: true })).toBeVisible();
  await expect(dialog.getByText("November, due Dec 10")).toBeVisible();
  await expect(dialog.getByText("July", { exact: true })).toBeVisible();

  const october = dialog.getByRole("button", { name: /^October 2026/ });
  await expect(october).toHaveAttribute("aria-expanded", "true");
  const log = dialog.getByRole("list", { name: "October 2026 report log" });
  await expect(log.getByRole("listitem")).toHaveCount(3);
  await expect(log.getByRole("listitem").nth(0)).toContainText("Added to city summary");
  await expect(log.getByRole("listitem").nth(0)).toContainText("Included in CON-OCT-2026-0001, prepared by Jose Cruz.");
  await expect(log.getByRole("listitem").nth(1)).toContainText("Review completed");
  await expect(log.getByRole("listitem").nth(2)).toContainText("Report submitted");
  await expect(log.getByRole("listitem").nth(2)).toContainText("Nov 1, 8:30 AM");

  // Six months show at first; the rest of the year is one click away.
  await expect(dialog.getByRole("button", { name: /^(January|February|March|April|May) 2026/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Show all 11 months of 2026" }).click();
  await expect(dialog.getByRole("button", { name: /^January 2026/ })).toBeVisible();

  // Opening November closes October and shows its whole log. The header and contact details stay on
  // the opened month (October), and the dialog has no second scroll box for the months.
  await dialog.getByRole("button", { name: /^November 2026/ }).click();
  await expect(october).toHaveAttribute("aria-expanded", "false");
  const novemberLog = dialog.getByRole("list", { name: "November 2026 report log" });
  await expect(novemberLog).toContainText("Not sent yet");
  await expect(novemberLog).toBeInViewport();
  await expect(dialog.getByText("Edwin Ramos")).toBeVisible();
  await expect(dialog.getByText("October 2026 report")).toBeVisible();
  await expect(dialog.getByRole("region", { name: /scrollable/ })).toHaveCount(0);
  await testInfo.attach("enterprise-report-details-light", { body: await page.screenshot(), contentType: "image/png" });

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/enterprise=/);
  await expect(marketRow).toBeFocused();
});

test("a link opens one enterprise's details on the linked month, in dark mode too", async ({ page }, testInfo) => {
  await openEnterpriseReports(page, "/admin/reports?enterprise=resort&month=October&year=2026", "dark");

  const dialog = page.getByRole("dialog", { name: "Laguna Lakeside Resort" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("list", { name: "October 2026 report log" })).toContainText("No report was received by Nov 10, 2026.");
  await expect(dialog.getByText("Rosa Lim")).toHaveCount(0);
  await expect(dialog.getByText("Shown once the October 2026 report is sent.")).toBeVisible();

  await dialog.getByRole("radio", { name: "2025" }).click();
  await expect(dialog.getByText("0 of 10", { exact: true })).toBeVisible();
  await expect(dialog.getByText("None in 2025")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^December 2025/ })).toHaveAttribute("aria-expanded", "false");

  await waitForStillPage(page);
  await testInfo.attach("enterprise-report-details-dark", { body: await page.screenshot(), contentType: "image/png" });
  await dialog.getByRole("button", { name: "Close report details" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/month=October&year=2026/);
});
