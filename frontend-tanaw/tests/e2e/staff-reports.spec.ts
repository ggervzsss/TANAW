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

test("Staff returns a report for correction with remarks, and it then opens read only", async ({ page }) => {
  const state = await mockReports(page, { now: "2026-11-24T10:00:00+08:00" });
  await page.goto("/staff/reports?month=2026-10&report=plaza-oct");
  const dialog = page.getByRole("dialog", { name: "Enterprise report", exact: true });
  await expect(dialog.getByText("City Plaza Shops · October 2026")).toBeVisible();
  await expect(dialog.getByText("No notes were sent with this report.")).toBeVisible();

  await dialog.getByRole("button", { name: "Return for correction" }).click();
  const returnDialog = page.getByRole("dialog", { name: "Return for correction" });
  await returnDialog.getByRole("button", { name: "Return report" }).click();
  await expect(returnDialog.getByText("Say what the enterprise needs to correct.")).toBeVisible();
  await returnDialog.getByRole("textbox", { name: "What needs correcting" }).fill("The October 14 count is missing.");
  await returnDialog.getByRole("button", { name: "Return report" }).click();
  await expect.poll(() => state.updates).toEqual([{ status: "Returned", remarks: "The October 14 count is missing." }]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/report=/);

  const row = page.getByRole("row", { name: /City Plaza Shops/ });
  await expect(row.getByText("Reviewing", { exact: true })).toBeVisible();
  await expect(row.getByText("Returned for correction")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate consolidated report" })).toBeDisabled();
  await expect(page.locator("#staff-reports-status")).toContainText("1 reviewing, 0 waiting.");

  await page.getByRole("tab", { name: /^Reviewing/ }).click();
  await expect(page).toHaveURL(/tab=reviewing/);
  await expect(page.getByRole("row", { name: /Laguna Lakeside Resort/ })).toHaveCount(0);
  await page.getByRole("button", { name: "View the report from City Plaza Shops" }).click();
  await expect(dialog.getByText("Returned for correction: The October 14 count is missing.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Accept report" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Before the due date an enterprise without a report is Pending, not Missing", async ({ page }) => {
  await mockReports(page, { now: "2026-11-05T10:00:00+08:00", intake: [] });
  await page.goto("/staff/reports");
  await expect(page.getByRole("combobox", { name: "Reporting month" })).toContainText("October 2026");
  await expect(page.getByRole("tab", { name: /^Pending\s*2$/ })).toBeVisible();
  await expect(page.locator("#staff-reports-status")).toContainText("No October 2026 reports received yet. City Plaza Shops and Laguna Lakeside Resort have not sent reports yet.");
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
