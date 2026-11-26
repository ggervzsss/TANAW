import { expect, test, type Page } from "@playwright/test";
import { json, mockPortalSession, portalUser, waitForStillPage, type PortalTheme } from "./support/session";

test.use({ timezoneId: "Asia/Manila" });

const enterprises = [
  { id: "plaza", name: "City Plaza Shops", category: "Shopping", barangay: "Poblacion", complianceOwner: "Plaza Operator" },
  { id: "resort", name: "Laguna Lakeside Resort", category: "Resort", barangay: "Landayan", complianceOwner: "Resort Operator" },
];

function intakeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "plaza-oct",
    enterpriseId: "plaza",
    enterprise: "City Plaza Shops",
    category: "Shopping",
    attraction: { code: "205", typeCode: "2", type: "Shopping", category: "Mall", portfolioCategory: "Shopping Tourism", ntdpCode: "TD205" },
    barangay: "Poblacion",
    month: "October",
    period: "October 2026",
    submitted: "2026-11-09T09:00:00+08:00",
    submittedAt: "2026-11-09T09:00:00+08:00",
    status: "Pending Review",
    code: "RPT-2026-10-003",
    metrics: { entry: 40, exit: 38, unique: 35, peak: "12" },
    ...overrides,
  };
}

async function mockReports(page: Page, options: { theme?: PortalTheme; now: string; intake?: Record<string, unknown>[]; final?: Record<string, unknown>[] }) {
  const state = { intake: options.intake ?? [intakeReport()], updates: [] as unknown[] };
  await page.clock.setFixedTime(new Date(options.now));
  await mockPortalSession(page, portalUser("staff"), { theme: options.theme });
  await page.route("**/operational/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/reports/enterprises")) return route.fulfill(json(enterprises));
    const status = /\/reports\/intake\/([^/]+)\/status$/.exec(path);
    if (status && request.method() === "PATCH") {
      state.updates.push(request.postDataJSON());
      state.intake = state.intake.map((report) => (report.id === status[1] ? { ...report, ...request.postDataJSON() } : report));
      return route.fulfill(json(state.intake.find((report) => report.id === status[1])));
    }
    if (path.endsWith("/reports/intake")) return route.fulfill(json(state.intake));
    if (path.endsWith("/reports/final")) return route.fulfill(json(options.final ?? []));
    return route.fulfill(json([]));
  });
  return state;
}

test("A submitted report is Reviewing and can only be accepted; an enterprise yet to send one is Waiting", async ({ page }) => {
  const state = await mockReports(page, { now: "2026-11-24T10:00:00+08:00" });
  await page.goto("/staff/reports?month=2026-10&report=plaza-oct");
  const dialog = page.getByRole("dialog", { name: "Enterprise report", exact: true });
  await expect(dialog.getByText("City Plaza Shops · October 2026")).toBeVisible();
  await expect(dialog.getByText("No notes were sent with this report.")).toBeVisible();
  await expect(dialog.getByText("Reviewing", { exact: true })).toBeVisible();
  // The enterprise report has no download or print.
  await expect(dialog.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Print" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Accept report" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await expect(page.getByText("Reports for October 2026, due November 10. Accept each submitted report, then generate the consolidated report.")).toBeVisible();
  // Missing first, then Submitted; the submitted report is Reviewing, the missing one Waiting.
  const rows = page.locator("tbody tr");
  await expect(rows.nth(0)).toContainText("Laguna Lakeside Resort");
  await expect(rows.nth(1)).toContainText("City Plaza Shops");
  const plaza = page.getByRole("row", { name: /City Plaza Shops/ });
  const resort = page.getByRole("row", { name: /Laguna Lakeside Resort/ });
  await expect(plaza.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(plaza.getByText("Reviewing", { exact: true })).toBeVisible();
  await expect(resort.getByText("Missing", { exact: true })).toBeVisible();
  await expect(resort.getByText("Waiting", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate consolidated report" })).toBeDisabled();
  await expect(page.locator("#staff-reports-status")).toContainText("consolidated. Generate once");

  // Waiting lists the enterprise that has not sent a report; the filter is kept in the address.
  await page.getByRole("combobox", { name: "Staff review" }).click();
  await page.getByRole("option", { name: "Waiting", exact: true }).click();
  await expect(page).toHaveURL(/review=waiting/);
  await expect(resort).toBeVisible();
  await expect(plaza).toHaveCount(0);
  await expect(page.getByText(/^Showing 1 of \d+ enterprises/)).toBeVisible();

  await page.getByRole("combobox", { name: "Staff review" }).click();
  await page.getByRole("option", { name: "Reviewing", exact: true }).click();
  await expect(page).toHaveURL(/review=reviewing/);
  await expect(resort).toHaveCount(0);
  await page.getByRole("button", { name: "Review the report from City Plaza Shops" }).click();
  await dialog.getByRole("button", { name: "Accept report" }).click();
  await expect.poll(() => state.updates).toEqual([{ status: "Ready to Consolidate", remarks: "Accepted for consolidation." }]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/report=/);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(plaza.getByText("Consolidated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View the report from City Plaza Shops" }).click();
  await expect(dialog.getByRole("button", { name: "Accept report" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Before the due date an enterprise without a report is Pending, not Missing", async ({ page }) => {
  await mockReports(page, { now: "2026-11-05T10:00:00+08:00", intake: [] });
  await page.goto("/staff/reports");
  await expect(page.getByRole("combobox", { name: "Reporting month" })).toContainText("October 2026");
  await expect(page.locator("#staff-reports-status")).toHaveText("No October 2026 reports received yet.");
  // Both enterprises are Pending, not Missing, so the Pending filter lists them. Options carry no counts.
  await page.getByRole("combobox", { name: "Submission" }).click();
  await expect(page.getByRole("option", { name: "Missing", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Pending", exact: true }).click();
  await expect(page).toHaveURL(/submission=pending/);
  await expect(page.getByRole("row", { name: /City Plaza Shops/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Laguna Lakeside Resort/ })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/submission=/);

  // Search narrows the list, and Clear filters brings everyone back.
  await page.getByRole("searchbox", { name: "Search reports" }).fill("lakeside");
  await expect(page).toHaveURL(/q=lakeside/);
  await expect(page.getByRole("row", { name: /City Plaza Shops/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("row", { name: /City Plaza Shops/ })).toBeVisible();
  await expect(page).not.toHaveURL(/q=/);
  const row = page.getByRole("row", { name: /Laguna Lakeside Resort/ });
  await expect(row.getByText("Due Nov 10")).toBeVisible();
  await expect(row.getByText("Pending", { exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`Staff reports and consolidated reports read clearly in ${theme} mode`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const final = [
      {
        id: "CON-SEP-2026-0001",
        title: "Citywide Tourism Aggregation",
        period: "September 2026",
        generatedOn: "2026-10-09",
        preparedBy: "LGU Staff",
        preparedRole: "Staff Processing Division",
        status: "Finalized",
        enterpriseCount: 2,
        totalEntry: null,
        totalExit: null,
        totalUnique: 70552,
        sources: [{ id: "s1", enterpriseProfileId: "plaza", attractionCode: "205", enterprise: "City Plaza Shops", code: "RPT-2026-09-003", unique: 70552, entry: null, exit: null }],
      },
    ];
    await mockReports(page, { theme, now: "2026-11-24T10:00:00+08:00", final, intake: [intakeReport(), intakeReport({ id: "x", enterpriseId: "resort", enterprise: "Laguna Lakeside Resort", status: "Ready to Consolidate", code: "RPT-2026-10-011" })] });
    await page.goto("/staff/reports?month=2026-10");
    await expect(page.getByRole("button", { name: "Review the report from City Plaza Shops" })).toBeVisible();
    await waitForStillPage(page);
    await page.screenshot({ path: testInfo.outputPath(`staff-reports-${theme}.png`), animations: "disabled" });

    await page.goto("/staff/consolidated-reports");
    const row = page.getByRole("table", { name: "Monthly reports for 2026" }).getByRole("row", { name: /September 2026/ });
    await expect(row).toContainText("2 of 2");
    await expect(row).toContainText("70,552");
    await expect(row).toContainText("Oct 9, 2026");
    await waitForStillPage(page);
    await page.screenshot({ path: testInfo.outputPath(`consolidated-reports-${theme}.png`), animations: "disabled" });
  });
}
