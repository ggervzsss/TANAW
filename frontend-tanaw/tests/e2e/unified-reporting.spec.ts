import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("Staff reviews and consolidates the frozen Open Space establishment report once", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const saved = JSON.parse(readFileSync(new URL("../../../test-fixtures/open-space-establishment-report.json", import.meta.url), "utf8"));
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
  const final = {
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
    if (path.endsWith("/reports/enterprises")) return route.fulfill({ json: [{ id: "park-fixture", name: "Park", category: "Tourism", barangay: "Poblacion", complianceOwner: "Park Operator" }] });
    if (path.endsWith("/reports/intake/source-one/status")) {
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
    if (path.endsWith("/reports/final")) return route.fulfill({ json: generated ? [final] : [] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/staff/batch-reports?month=October&year=2026");
  await page.locator("tbody tr").filter({ hasText: "Park" }).click();
  await page.getByRole("button").filter({ hasText: "REP-FIXTURE" }).click();
  await expect(page.getByRole("heading", { name: "Review DOT Form Generation" })).toBeVisible();
  const basis = page.getByRole("region", { name: "Establishment counting basis" });
  await expect(basis).toContainText("Not measured");
  await expect(basis).toContainText("period adds daily estimates");
  await basis.getByText("Camera evidence and snapshot", { exact: true }).click();
  await expect(basis).toContainText(saved.counting.snapshot_version);
  await expect(basis).toContainText("Camera 1: 2 daily visitor observations");
  await expect(page.getByText("Zone A - Main Entrance")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("staff-unified-intake.png") });
  await page.getByRole("button", { name: "Accept & Mark Ready" }).click();
  await page.getByRole("button", { name: "Accept Report", exact: true }).click();
  await expect.poll(() => intake.status).toBe("Ready to Consolidate");
  await page.goto("/staff/batch-reports?month=October&year=2026");
  await page.getByRole("button", { name: "Generate Final Report", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Generate Final Report?" }).getByRole("button", { name: "Generate Final Report", exact: true }).click();
  await expect.poll(() => generated).toBe(true);
  await page.goto("/staff/final-reports-audit");
  const row = page.locator("tbody tr").filter({ hasText: final.id });
  await expect(row).toContainText("Entry: Not measured");
  await expect(row).toContainText("Unique: 2");
  await row.click();
  await page.getByText("Establishment counting details", { exact: true }).click();
  const finalBasis = page.getByRole("region", { name: "Establishment counting basis" });
  await finalBasis.getByText("Camera evidence and snapshot", { exact: true }).click();
  await expect(finalBasis).toContainText(saved.counting.snapshot_version);
  await expect(finalBasis).toContainText("Do not add it to the establishment total");
  await page.screenshot({ path: testInfo.outputPath("staff-unified-consolidated.png") });
  expect(generations).toBe(1);
});
