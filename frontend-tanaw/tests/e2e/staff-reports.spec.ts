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
  const state = { intake: options.intake ?? [intakeReport()], updates: [] as unknown[], returns: [] as unknown[] };
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
    const returned = /\/reports\/intake\/([^/]+)\/return$/.exec(path);
    if (returned && request.method() === "POST") {
      const { reason } = request.postDataJSON() as { reason: string };
      state.returns.push({ reason });
      state.intake = state.intake.map((report) =>
        report.id === returned[1] ? { ...report, status: "Returned", returnedReason: reason, returnedAt: options.now, returnedBy: "Maria Santos" } : report,
      );
      return route.fulfill(json(state.intake.find((report) => report.id === returned[1])));
    }
    if (path.endsWith("/reports/intake")) return route.fulfill(json(state.intake));
    if (path.endsWith("/reports/final")) return route.fulfill(json(options.final ?? []));
    return route.fulfill(json([]));
  });
  return state;
}

test("A submitted report is Reviewing and can be accepted or returned; an enterprise yet to send one is Waiting", async ({ page }) => {
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
  await expect(dialog.getByRole("button", { name: "Return for correction" })).toBeVisible();
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

test("Staff return a report for correction with a reason, and it waits for the corrected version", async ({ page }) => {
  const state = await mockReports(page, { now: "2026-11-24T10:00:00+08:00" });
  await page.goto("/staff/reports?month=2026-10&report=plaza-oct");
  const dialog = page.getByRole("dialog", { name: "Enterprise report", exact: true });
  await dialog.getByRole("button", { name: "Return for correction" }).click();

  const returnDialog = page.getByRole("dialog", { name: "Return this report for correction" });
  await expect(returnDialog).toContainText("City Plaza Shops will see your reason in the desktop app and can send a corrected version.");
  const reason = returnDialog.getByRole("textbox", { name: "What needs to be corrected" });
  await expect(reason).toBeFocused();
  // Escape closes only the return dialog; the report stays open beneath it.
  await page.keyboard.press("Escape");
  await expect(returnDialog).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Return for correction" }).click();

  await returnDialog.getByRole("button", { name: "Return report" }).click();
  await expect(returnDialog.getByRole("alert")).toHaveText("Say what City Plaza Shops needs to correct.");
  await reason.fill("Too short");
  await expect(returnDialog.getByRole("alert")).toHaveText("Write at least 10 characters so City Plaza Shops knows what to correct.");
  await reason.fill("The visitor origins for Oct 28 to 31 do not add up.");
  await expect(returnDialog.getByText("51 / 500")).toBeVisible();
  await returnDialog.getByRole("button", { name: "Return report" }).click();

  await expect.poll(() => state.returns).toEqual([{ reason: "The visitor origins for Oct 28 to 31 do not add up." }]);
  await expect(page.getByText("Report returned to City Plaza Shops.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const plaza = page.getByRole("row", { name: /City Plaza Shops/ });
  await expect(plaza.getByText("Awaiting correction", { exact: true })).toBeVisible();
  await expect(plaza.getByText("Returned", { exact: true })).toBeVisible();
  await expect(plaza.getByRole("button", { name: "Remind City Plaza Shops", exact: true })).toBeVisible();
  await expect(page.locator("#staff-reports-status")).toContainText("1 returned report is awaiting correction.");

  await page.getByRole("button", { name: "View the report from City Plaza Shops" }).click();
  await expect(dialog.getByText("Returned on Nov 24 by Maria Santos: The visitor origins for Oct 28 to 31 do not add up.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Return for correction" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Accept report" })).toHaveCount(0);
});

test("A corrected version shows as a normal submitted report that names the version it replaces", async ({ page }) => {
  const returned = intakeReport({ status: "Returned", returnedReason: "Recount the visitor origins.", returnedAt: "2026-11-12T10:00:00+08:00", returnedBy: "Maria Santos" });
  const corrected = intakeReport({ id: "plaza-oct-v2", code: "RPT-2026-10-003-v2", version: 2, previousVersionId: "plaza-oct", submitted: "2026-11-14T09:00:00+08:00", submittedAt: "2026-11-14T09:00:00+08:00" });
  const state = await mockReports(page, { now: "2026-11-24T10:00:00+08:00", intake: [returned, corrected] });
  await page.goto("/staff/reports?month=2026-10");
  const plaza = page.getByRole("row", { name: /City Plaza Shops/ });
  await expect(plaza).toContainText("RPT-2026-10-003-v2");
  await expect(plaza.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(plaza.getByText("Reviewing", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review the report from City Plaza Shops" }).click();
  const dialog = page.getByRole("dialog", { name: "Enterprise report", exact: true });
  await expect(dialog.getByText("Version 2", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Replaces version 1 (returned: Recount the visitor origins.)")).toBeVisible();
  await dialog.getByRole("button", { name: "Accept report" }).click();
  await expect.poll(() => state.updates).toEqual([{ status: "Ready to Consolidate", remarks: "Accepted for consolidation." }]);
});

test("Before the due date an enterprise without a report is Pending, not Missing", async ({ page }) => {
  await mockReports(page, { now: "2026-11-05T10:00:00+08:00", intake: [] });
  await page.goto("/staff/reports");
  await expect(page.getByRole("button", { name: "Reporting month October 2026" })).toBeVisible();
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
