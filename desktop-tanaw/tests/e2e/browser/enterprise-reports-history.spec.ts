// Enterprise Reports workspace and the unified daily history.
import { selectDashboardPeriod } from "./support/dashboard";
import { expect, test } from "@playwright/test";
import { mlResponse, mockMlRequest, switchTheme } from "./support/preload";
import { signIn, defaultEnterpriseUser } from "./support/session";
import { token } from "../support/theme-and-filters";

test("keeps the modern Reports workspace dense, rounded, and fully interactive", async ({ page }) => {
  // About sixty steps across both themes, three viewports and the report preview; a busy full
  // suite run can take longer than the default 30 seconds.
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const reportDemo = {
    thisProvMale: "30",
    thisProvFemale: "30",
    otherProvMale: "15",
    otherProvFemale: "15",
    foreignMale: "5",
    foreignFemale: "5",
  };
  await mockMlRequest(page, "*", (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/context/enterprise") {
      return mlResponse({ status: 200, body: JSON.stringify({ enterprise_id: defaultEnterpriseUser.enterpriseId, enterprise_name: defaultEnterpriseUser.enterpriseName }) });
    }
    if (url.pathname === "/metrics/summary") {
      return mlResponse({
        status: 200,
        body: JSON.stringify({
          entries: 120,
          exits: 80,
          peak_occupancy: 40,
          current_occupancy: 40,
          unique_count: 100,
          estimated_unique_count: 100,
          confirmed_unique_count: 100,
          degraded_unique_count: 0,
          pending_unique_entries: 0,
          repeat_entry_count: 20,
          occupancy_correction_delta: 0,
          total_events: 200,
          unsubmitted_events: 200,
          unsynced_events: 0,
          first_event_at: "2026-08-01T00:00:00Z",
          last_event_at: "2026-08-10T12:00:00Z",
          period: "2026-08",
        }),
      });
    }
    if (url.pathname === "/reports/local") {
      return mlResponse({
        status: 200,
        body: JSON.stringify([
          {
            report_id: "REP-202607",
            period: "2026-07",
            submitted_at: "2026-08-01T01:00:00Z",
            entries: 140,
            exits: 90,
            peak_occupancy: 50,
            unique_count: 100,
            notes: "Monthly operational summary",
            payload: { status: "Consolidated", demo: reportDemo, metrics: { entries: 140, exits: 90, peak: 50, unique: 100 } },
            sync_status: "synced",
            synced_at: "2026-08-01T01:01:00Z",
            camera_breakdown: [],
          },
        ]),
      });
    }
    if (url.pathname.startsWith("/reports/drafts/")) return mlResponse({ status: 200, body: "null" });
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Not required by Reports presentation coverage" }) });
  });
  await page.route("**/operational/desktop/sample-preparation", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/operational/reports/intake", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/#/enterprise/reports");
  const workspace = page.locator("[data-reports-surface='var1-workspace']");
  await expect(workspace).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly DOT Visitor Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report Workspace" })).toHaveCount(0);
  await expect.poll(() => page.getByText("REP-202607", { exact: true }).count()).toBeGreaterThan(0);
  await expect(page.locator(".report-create-card")).toHaveCSS("border-radius", "16px");
  // The date picker lists the reporting month; dark surfaces stay distinct from the card.
  await page.locator(".report-day-picker > button").click();
  const calendar = page.getByRole("group", { name: /^Days of / });
  await expect(calendar).toBeVisible();
  const raised = await token(page, "--theme-raised");
  await expect(page.locator(".report-day-popover")).toHaveCSS("background-color", raised);
  expect(await page.locator(".report-create-card").evaluate((card) => getComputedStyle(card).backgroundColor)).not.toBe(raised);
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await page.getByText("Report details, notes and camera evidence", { exact: true }).click();
  const notes = page.getByPlaceholder("Add notes regarding events, closures, or demographic estimates...");
  await notes.fill("Updated report workspace notes");
  await expect(notes).toHaveValue("Updated report workspace notes");

  const search = page.getByPlaceholder("Search reports");
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await page.locator(".report-history-search > button").click();
  await search.fill("REP-202607");
  await expect(page.getByText("REP-202607", { exact: true }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Filter reports by status" }).click();
  await page.getByRole("option", { name: "Consolidated" }).click();
  await page.getByRole("button", { name: "View REP-202607", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Review Report Form", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS("border-radius", "16px");
  const reportPaper = preview.locator(".var1-document");
  await expect(reportPaper).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(reportPaper).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(reportPaper.getByRole("heading", { name: "TOURISM ATTRACTION VISITOR RECORD" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  await expect(preview.getByRole("button", { name: "Close preview", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Download PDF" })).toBeVisible();
  await preview.getByRole("button", { name: "Close preview", exact: true }).click();

  await switchTheme(page, "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("tab", { name: "Create Reports", exact: true }).click();
  // A report submitted before daily entry shows its monthly origins, without a date picker.
  await expect(page.getByRole("table", { name: "Monthly visitor origins" })).toBeVisible();
  await expect(page.locator(".report-day-picker")).toHaveCount(0);
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(workspace).toBeVisible();
  await expect(page.getByRole("button", { name: "Search reports", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("presents unified daily history and distinguishes observed zero from missing data", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1100, height: 760 });
  await signIn(page);
  await mockMlRequest(page, "/metrics/establishment/live", () =>
    mlResponse({
      status: 200,
      body: JSON.stringify({
        enterprise_id: defaultEnterpriseUser.enterpriseId,
        occupancy: 15,
        partial_occupancy: 15,
        state: "estimated",
        contributions: [],
        excluded_camera_ids: [],
        missing_camera_ids: [],
      }),
    }),
  );
  await mockMlRequest(page, "/metrics/establishment/summary", (request) => {
    const query = new URL(request.url).searchParams;
    const start = query.get("start")!;
    const end = query.get("end")!;
    const length = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
    const zero = length === 30;
    const days = Array.from({ length }, (_, index) => ({
      business_date: new Date(Date.parse(start) + index * 86400000 + 8 * 3600000).toISOString().slice(0, 10),
      covered_ms: 86400000,
      qualified_observations: zero ? 0 : 2,
      identification_state: "available",
      unique_count: zero ? 0 : 2,
      peak_occupancy: zero ? 0 : 3,
    }));
    return mlResponse({
      status: 200,
      body: JSON.stringify({
        enterprise_id: defaultEnterpriseUser.enterpriseId,
        from_at: start,
        to_at: end,
        days,
        days_available: length,
        days_requested: length,
        unique_count: zero ? 0 : length * 2,
        entries: zero ? 0 : length * 3,
        exits: zero ? 0 : length,
        peak_occupancy: zero ? 0 : 3,
        reconciliation_state: "estimated",
        identification_state: "available",
        movement_state: "available",
        coverage_ratio: 1,
        unresolved_observations: 0,
        source_breakdown: [],
      }),
    });
  });
  await mockMlRequest(page, "/reports/local", () => mlResponse({ status: 200, body: "[]" }));
  await page.goto("/#/enterprise/dashboard");
  const header = page.locator("[data-unified-metrics-header]");
  await expect(header.getByText("Live Occupancy", { exact: true })).toBeVisible();
  await expect(header.locator('[data-metric-segment="occupancy"]').getByText("15", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Dashboard date range/ })).toContainText("Today,");
  await expect(header.locator('[data-metric-segment="entries"]').getByText("3", { exact: true })).toBeVisible();
  await selectDashboardPeriod(page, "Month");
  await expect(header.locator('[data-metric-segment="entries"]').getByText("0", { exact: true })).toBeVisible();
  await expect(header.locator('[data-metric-segment="peak"]')).toContainText("No visitors recorded yet");
  await selectDashboardPeriod(page, "Today");
  await expect(page.getByRole("button", { name: "Back to present" })).toHaveCount(0);
  await switchTheme(page, "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("keeps the camera-service warning and explains unavailable historical data", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1100, height: 760 });
  await signIn(page);
  let requests = 0;
  await mockMlRequest(page, "/metrics/establishment/summary", () => {
    requests += 1;
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Establishment history intentionally unavailable" }) });
  });
  await page.goto("/#/enterprise/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByText("History unavailable. Check the local camera service.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("group", { name: /Visitor traffic chart/ })).toHaveCount(0);
});
