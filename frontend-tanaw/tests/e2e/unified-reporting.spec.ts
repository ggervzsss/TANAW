import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("Staff reviews and consolidates the frozen Open Space establishment report once", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const saved = JSON.parse(readFileSync(new URL("../../../desktop-tanaw/ml-service/tests/fixtures/reports/open-space-establishment-report.json", import.meta.url), "utf8"));
  const user = { id: "staff-review", email: "staff@example.test", displayName: "Staff Reviewer", role: "staff", title: "LGU Staff" };
  let intake = {
    id: "source-one",
    enterpriseId: "park-fixture",
    enterprise: "Park",
    category: "Tourism",
    barangay: "Poblacion",
    month: "October",
    period: saved.period,
    submitted: saved.submitted_at,
    submittedAt: saved.submitted_at,
    status: "Pending Review",
    code: saved.report_id,
    metrics: { entry: null, exit: null, unique: 2, peak: "2" },
    payload: saved.payload,
    demographics: { thisProvMale: 1, thisProvFemale: 1, otherProvMale: 0, otherProvFemale: 0, foreignMale: 0, foreignFemale: 0 },
  };
  let final = {
    id: "CON-OCT-2026-0001",
    title: "Citywide Tourism Aggregation",
    period: saved.period,
    generatedOn: "2026-11-03",
    preparedBy: "Staff Reviewer",
    preparedRole: "Staff Processing Division",
    status: "Draft",
    enterpriseCount: 1,
    totalEntry: null,
    totalExit: null,
    totalUnique: 2,
    sources: [{ id: intake.id, enterprise: "Park", code: intake.code, unique: 2, entry: null, exit: null, demographics: intake.demographics, counting: saved.counting }],
  };
  let generated = false;
  let generations = 0;
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
    if (path.endsWith("/reports/intake/source-one/status")) {
      expect(route.request().postDataJSON().remarks).toBe("Reviewed for consolidation.");
      intake = { ...intake, ...route.request().postDataJSON() };
      return route.fulfill({ json: intake });
    }
    if (path.endsWith("/reports/intake")) return route.fulfill({ json: [intake] });
    if (path.endsWith("/reports/final") && route.request().method() === "POST") {
      expect(route.request().postDataJSON().reportIds).toEqual(["source-one"]);
      generations += 1;
      generated = true;
      intake.status = "Consolidated";
      return route.fulfill({ json: final });
    }
    if (path.endsWith(`/reports/final/${final.id}/status`)) {
      expect(route.request().postDataJSON()).toEqual({ status: "Finalized" });
      final = { ...final, status: "Finalized" };
      return route.fulfill({ json: final });
    }
    if (path.endsWith("/reports/final")) return route.fulfill({ json: generated ? [final] : [] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/staff/batch-reports?month=October&year=2026");
  const generation = page.getByRole("region", { name: "Monthly report", exact: true });
  const generate = generation.getByRole("button", { name: "Generate monthly report", exact: true });
  await expect(generate).toBeDisabled();
  await expect(generation.getByText("0 of 2 establishments ready.")).toBeVisible();
  await expect(generation.getByText(/1 pending review · 1 missing/)).toBeVisible();

  const followUp = page.getByRole("region", { name: "Missing or returned" });
  await followUp.getByRole("button", { name: "Follow up for Riverside Museum" }).click();
  const museumDialog = page.getByRole("dialog", { name: "Riverside Museum" });
  await expect(museumDialog.getByText("No report submitted for this period.")).toBeVisible();
  await expect(museumDialog.getByRole("button", { name: "Send submission reminder" })).toBeVisible();
  await museumDialog.getByRole("button", { name: "Close establishment submissions" }).click();

  await page.screenshot({ path: testInfo.outputPath("batch-reports-light.png"), animations: "disabled" });
  const queue = page.getByRole("region", { name: "Pending review" });
  await queue.getByRole("button", { name: "Review report for Park", exact: true }).click();
  const intakeDialog = page.getByRole("dialog", { name: "Establishment report", exact: true });
  await expect(intakeDialog).toBeVisible();
  const table = intakeDialog.getByRole("table", { name: "Park VAR 2M" });
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
  await intakeDialog.getByRole("textbox", { name: /review remarks/i }).fill("Reviewed for consolidation.");
  await intakeDialog.getByRole("button", { name: "Accept & mark ready" }).click();
  await page.getByRole("dialog", { name: "Accept report?" }).getByRole("button", { name: "Accept report", exact: true }).click();
  await expect.poll(() => intake.status).toBe("Ready to Consolidate");
  await expect(queue).toBeHidden();
  await page.getByRole("tab", { name: /^Ready/ }).click();
  await expect(page.getByRole("tabpanel", { name: /^Ready/ }).getByRole("button", { name: "View report for Park" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search submissions" });
  await search.fill("Park");
  await expect(generate).toBeDisabled();
  await expect(generation.getByText("1 of 2 establishments ready.")).toBeVisible();
  await search.clear();

  const barangay = page.getByRole("combobox", { name: "Barangay" });
  await barangay.click();
  await page.getByRole("option", { name: "Poblacion", exact: true }).click();
  await expect(generate).toBeEnabled();
  await expect(generate).toBeInViewport({ ratio: 1 });
  await generate.click();
  await page.getByRole("dialog", { name: "Generate monthly report?" }).getByRole("button", { name: "Generate monthly report", exact: true }).click();
  const monthlyDialog = page.getByRole("dialog", { name: "Monthly report (VAR 2M)" });
  const monthlyTable = monthlyDialog.getByRole("table", { name: "VAR 2M October 2026" });
  await expect(monthlyTable.getByRole("rowheader", { name: "Park" })).toBeVisible();
  await expect(monthlyTable.locator("tfoot td").last()).toHaveText("2");
  await expect(monthlyDialog.getByText(/Report History|Establishment counting details|Citywide arrivals|Camera evidence/)).toHaveCount(0);
  await expect(monthlyTable).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("staff-unified-consolidated-light.png"), animations: "disabled" });
  await monthlyDialog.getByRole("button", { name: "Finalize monthly report" }).click();
  await expect(monthlyDialog.getByRole("button", { name: "Finalize monthly report" })).toHaveCount(0);
  await monthlyDialog.getByRole("button", { name: "Close report" }).click();

  await page.getByRole("tab", { name: /^Completed/ }).click();
  const completed = page.getByRole("tabpanel", { name: /^Completed/ });
  await completed.getByRole("button", { name: "View report for Park" }).click();
  await expect(intakeDialog.getByText("Consolidated", { exact: true })).toBeVisible();
  await intakeDialog.getByRole("button", { name: "Close report" }).click();
  await generation.getByRole("link", { name: "View generated reports" }).click();
  await expect(page).toHaveURL(/generated-reports\?month=October&year=2026$/);
  const generatedReports = page.getByRole("region", { name: "Monthly reports (VAR 2M)" });
  await expect(generatedReports.getByRole("button", { name: `View monthly report ${final.id}` })).toBeVisible();
  await expect(generatedReports.getByText("Finalized", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("generated-reports-light.png"), animations: "disabled" });
  await generatedReports.getByRole("button", { name: "View annual report" }).click();
  const annualDialog = page.getByRole("dialog", { name: "Annual report (VAR 3M)" });
  await expect(annualDialog.getByRole("row", { name: /^October/ })).toContainText("2");
  expect(generations).toBe(1);
});
