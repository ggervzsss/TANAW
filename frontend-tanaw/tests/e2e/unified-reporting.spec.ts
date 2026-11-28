import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Report due dates and "Submitted Nov 2" are local calendar days in San Pedro, Laguna.
test.use({ timezoneId: "Asia/Manila" });

test("Staff reviews, accepts and consolidates the frozen Open Space establishment report once", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const saved = JSON.parse(readFileSync(new URL("../../../desktop-tanaw/ml-service/tests/fixtures/reports/open-space-establishment-report.json", import.meta.url), "utf8"));
  const user = { id: "staff-review", email: "staff@example.test", displayName: "Staff Reviewer", role: "staff", title: "LGU Staff" };
  let intake = {
    id: "source-one",
    enterpriseId: "park-fixture",
    enterprise: "Park",
    category: "Parks",
    attraction: { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" },
    barangay: "Poblacion",
    month: "October",
    period: saved.period,
    submitted: saved.submitted_at,
    submittedAt: saved.submitted_at,
    status: "Pending Review",
    code: saved.report_id,
    notes: "Monthly visitor count submitted for LGU review.",
    metrics: { entry: null, exit: null, unique: 2, peak: "2" },
    payload: saved.payload,
    demographics: { thisProvMale: 1, thisProvFemale: 1, otherProvMale: 0, otherProvFemale: 0, foreignMale: 0, foreignFemale: 0 },
  };
  // Riverside Museum has not sent its October report, so consolidating October gives a Draft.
  const final = {
    id: "CON-OCT-2026-0001",
    title: "Citywide Tourism Aggregation",
    period: saved.period,
    generatedOn: "2026-11-24",
    preparedBy: "Staff Reviewer",
    preparedRole: "Staff Processing Division",
    status: "Draft",
    enterpriseCount: 1,
    enterpriseTotal: 2,
    generatedAt: "2026-11-24T10:00:00+08:00",
    updatedAt: "2026-11-24T10:00:00+08:00",
    totalEntry: null,
    totalExit: null,
    totalUnique: 2,
    sources: [{ id: intake.id, enterpriseProfileId: "park-profile", attractionCode: "411", enterprise: "Park", code: intake.code, unique: 2, entry: null, exit: null, demographics: intake.demographics, counting: saved.counting }],
  };
  // A finalized September, so the annual report has a month to add up.
  const september = {
    ...final,
    id: "CON-SEP-2026-0001",
    period: "September 2026",
    generatedOn: "2026-10-12",
    status: "Finalized",
    enterpriseTotal: 1,
    generatedAt: "2026-10-12T10:00:00+08:00",
    updatedAt: "2026-10-12T10:00:00+08:00",
    sources: [{ ...final.sources[0], id: "source-september" }],
  };
  let generated = false;
  let generations = 0;
  const reminders: unknown[] = [];
  // After the October due date (Nov 10), so an enterprise with no report is Missing.
  await page.clock.setFixedTime(new Date("2026-11-24T10:00:00+08:00"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/auth/session", (route) => route.fulfill({ json: { token: "staff-review-token", user } }));
  await page.route("**/auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/auth/preferences", (route) => route.fulfill({ json: { theme: "light" } }));
  await page.route("**/operational/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/reports/enterprises")) return route.fulfill({
      json: [
        { id: "park-fixture", name: "Park", category: "Tourism", barangay: "Poblacion", complianceOwner: "Park Operator" },
        { id: "museum-fixture", name: "Riverside Museum", category: "Tourism", barangay: "Nueva", complianceOwner: "Museum Operator" },
      ],
    });
    if (path.endsWith("/notifications/enterprise")) {
      reminders.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/reports/intake/source-one/status")) {
      expect(route.request().postDataJSON()).toEqual({ status: "Ready to Consolidate", remarks: "Accepted for consolidation." });
      intake = { ...intake, ...route.request().postDataJSON() };
      return route.fulfill({ json: intake });
    }
    if (path.endsWith("/reports/intake")) return route.fulfill({ json: [intake] });
    if (path.endsWith("/reports/final") && route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ reportIds: ["source-one"], preparedBy: "Staff Reviewer", period: "October 2026" });
      generations += 1;
      generated = true;
      intake.status = "Consolidated";
      return route.fulfill({ json: final });
    }
    if (path.endsWith("/reports/final")) return route.fulfill({ json: generated ? [final, september] : [september] });
    return route.fulfill({ json: [] });
  });

  await page.goto("/staff/reports?month=2026-10");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(page.getByText("Reports for October 2026, due November 10. Accept each submitted report, then generate the consolidated report.")).toBeVisible();
  const generate = page.getByRole("button", { name: "Generate consolidated report", exact: true });
  await expect(generate).toBeDisabled();
  await expect(page.getByText("Accept at least one report to generate the consolidated report.")).toBeVisible();
  await page.getByRole("combobox", { name: "Submission" }).click();
  await expect(page.getByRole("option", { name: "Missing", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const museumRow = page.getByRole("row", { name: /Riverside Museum/ });
  await expect(museumRow.getByText("Missing", { exact: true })).toBeVisible();
  await expect(museumRow.getByText("14 days overdue")).toBeVisible();
  await museumRow.getByRole("button", { name: "Remind Riverside Museum", exact: true }).click();
  await expect(museumRow.getByRole("button", { name: "Reminded Riverside Museum", exact: true })).toBeDisabled();
  await expect(museumRow.getByRole("button", { name: "Reminded Riverside Museum", exact: true })).toHaveText("Reminded");
  await expect(page.getByText("Reminder sent to Riverside Museum for October 2026.", { exact: true })).toBeVisible();
  expect(reminders).toEqual([expect.objectContaining({ enterpriseId: "museum-fixture", message: "Please send your October 2026 monthly report. It was due Nov 10." })]);

  await page.screenshot({ path: testInfo.outputPath("staff-reports-light.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Review the report from Park", exact: true }).click();
  await expect(page).toHaveURL(/report=source-one/);
  const intakeDialog = page.getByRole("dialog", { name: "Enterprise report", exact: true });
  await expect(intakeDialog).toBeVisible();
  await expect(intakeDialog.getByText("Park · October 2026")).toBeVisible();
  await expect(intakeDialog.getByText(`${saved.report_id} · Submitted Nov 2 from the TANAW desktop app`)).toBeVisible();
  await expect(intakeDialog.getByText("Monthly visitor count submitted for LGU review.")).toBeVisible();
  const table = intakeDialog.getByRole("table", { name: "Park VAR 2M" });
  await expect(table.getByRole("cell", { name: "411", exact: true })).toBeVisible();
  await expect(table.locator("tfoot td").last()).toHaveText("2");
  await expect(intakeDialog.getByText(/Establishment Report Details|Saved Establishment Summary|counting basis|Camera evidence/)).toHaveCount(0);
  await expect(table).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("staff-unified-intake-light.png"), animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  const compactTable = intakeDialog.getByRole("table", { name: "Grand Total Number of Visitors" });
  await expect(compactTable.locator("tfoot td").last()).toHaveText("2");
  const dialogBody = intakeDialog.locator("[data-dialog-body]");
  await expect.poll(() => dialogBody.evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("staff-unified-intake-narrow.png"), animations: "disabled" });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await intakeDialog.getByRole("button", { name: "Accept report", exact: true }).click();
  await expect.poll(() => intake.status).toBe("Ready to Consolidate");
  await expect(intakeDialog).toBeHidden();
  await expect(page).not.toHaveURL(/report=/);
  await expect(page.getByRole("row", { name: /Park/ }).getByText("Consolidated", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "View the report from Park" }).click();
  await expect(intakeDialog.getByRole("button", { name: "Accept report" })).toHaveCount(0);
  await expect(intakeDialog.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await intakeDialog.getByRole("button", { name: "Close report" }).click();

  // Riverside Museum has not sent a report, so Generate warns first and makes a Draft.
  await expect(generate).toBeEnabled();
  await generate.click();
  const confirm = page.getByRole("dialog", { name: "Incomplete Report Submissions" });
  await expect(confirm).toContainText("Some enterprises have not yet submitted their reports. Are you sure you want to proceed with the consolidation?");
  await expect(confirm).toContainText("1 of 2 enterprises has not sent a report.");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(generations).toBe(0);
  await generate.click();
  await confirm.getByRole("button", { name: "Proceed", exact: true }).click();

  await expect(page).toHaveURL(/\/staff\/consolidated-reports\?year=2026&report=CON-OCT-2026-0001$/);
  const monthlyDialog = page.getByRole("dialog", { name: "Monthly report (VAR 2M)" });
  await expect(monthlyDialog.getByText("Draft — not final", { exact: true })).toBeVisible();
  await expect(monthlyDialog.getByText(/^This draft includes 1 of 2 enterprises/)).toBeVisible();
  const monthlyTable = monthlyDialog.getByRole("table", { name: "VAR 2M October 2026" });
  await expect(monthlyTable.getByRole("rowheader", { name: "Park" })).toBeVisible();
  await expect(monthlyTable.getByRole("cell", { name: "411", exact: true })).toBeVisible();
  await expect(monthlyTable.locator("tfoot td").last()).toHaveText("2");
  await expect(monthlyDialog.getByText(/Report History|Establishment counting details|Citywide arrivals|Camera evidence/)).toHaveCount(0);
  await expect(monthlyTable).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("staff-unified-consolidated-light.png"), animations: "disabled" });
  await expect(monthlyDialog.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await expect(monthlyDialog.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  // A draft is finalized from Reports once every report is in, not from here.
  await expect(monthlyDialog.getByRole("button", { name: /Finalize/ })).toHaveCount(0);
  await monthlyDialog.getByRole("button", { name: "Close report" }).click();
  await expect(page).toHaveURL(/\/staff\/consolidated-reports\?year=2026$/);

  const monthlyRow = page.getByRole("table", { name: "Monthly reports for 2026" }).getByRole("row", { name: /October 2026/ });
  await expect(monthlyRow).toContainText(final.id);
  await expect(monthlyRow).toContainText("1 of 2");
  await expect(monthlyRow.getByText("Draft", { exact: true })).toBeVisible();
  const septemberRow = page.getByRole("table", { name: "Monthly reports for 2026" }).getByRole("row", { name: /September 2026/ });
  await expect(septemberRow.getByText("Consolidated", { exact: true })).toBeVisible();
  await expect(monthlyRow.getByRole("button", { name: "View the October 2026 report" })).toBeVisible();
  await expect(monthlyRow.getByRole("button", { name: /PDF/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("consolidated-reports-light.png"), animations: "disabled" });

  await page.getByRole("tab", { name: "Annual (VAR 3M)" }).click();
  await expect(page).toHaveURL(/tab=annual/);
  const annualRow = page.getByRole("table", { name: "Annual reports" }).getByRole("row", { name: /2026/ });
  // Only finalized September counts; the October draft is left out until it is final.
  await expect(annualRow).toContainText("1 of 12");
  await expect(annualRow).toContainText("1 draft not counted");
  await expect(annualRow.getByText("Waiting", { exact: true })).toBeVisible();
  await expect(annualRow.getByRole("button", { name: /PDF/ })).toHaveCount(0);
  await annualRow.getByRole("button", { name: "View the 2026 annual report" }).click();
  await expect(page).toHaveURL(/annual=2026/);
  const annualDialog = page.getByRole("dialog", { name: "Annual report (VAR 3M)" });
  await expect(annualDialog.getByRole("columnheader", { name: "Park - 411" })).toBeVisible();
  await expect(annualDialog.getByText("City of San Pedro, Laguna · 2026", { exact: true })).toBeVisible();
  await expect(annualDialog.getByRole("combobox", { name: "Report year" })).toHaveCount(0);
  await expect(annualDialog.getByText(/months finalized/)).toHaveCount(0);
  await expect(annualDialog.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  await expect(annualDialog.getByRole("row", { name: /^September/ })).toContainText("2");
  await expect(annualDialog.getByText("October is still a draft and is not counted until it is final.")).toBeVisible();
  expect(generations).toBe(1);
});
