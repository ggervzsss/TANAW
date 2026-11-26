import { selectDashboardPeriod } from "./support/dashboard";
import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest, switchTheme } from "./support/preload";

const enterpriseUser = {
  id: "enterprise-unified-metrics",
  name: "Unified Metrics Enterprise",
  displayName: "Unified Metrics Enterprise",
  email: "enterprise.metrics@example.test",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "unified_metrics@tanaw.sanpedro",
  enterpriseName: "Unified Metrics Enterprise",
  buildingCapacity: 100,
};

const localReport = {
  report_id: "REP-PEAK-001",
  period: "July 2026",
  submitted_at: "2026-07-29T08:00:00Z",
  entries: 60,
  exits: 50,
  peak_occupancy: 18,
  unique_count: 40,
  notes: null,
  sync_status: "submitted",
  payload: {
    status: "Submitted",
    metrics: { entries: 60, exits: 50, peak: 18, unique: 40 },
    demo: {
      thisProvMale: "10",
      thisProvFemale: "10",
      otherProvMale: "6",
      otherProvFemale: "6",
      foreignMale: "4",
      foreignFemale: "4",
    },
  },
};

async function signIn(page: Page, reportCount = 1) {
  let signedIn = false;
  await page.addInitScript(() => window.localStorage.setItem("tanaw-enterprise-theme", "dark"));
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "enterprise-metrics-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/session", (route) => {
    if (!signedIn) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Not authenticated" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "enterprise-metrics-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(enterpriseUser) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/requests", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await mockMlRequest(page, "*", (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/context/enterprise") {
      return mlResponse({
        status: 200,
        body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }),
      });
    }
    if (pathname === "/metrics/establishment/live")
      return mlResponse({
        status: 200,
        body: JSON.stringify({
          enterprise_id: enterpriseUser.enterpriseId,
          occupancy: 12,
          partial_occupancy: 12,
          state: "estimated",
          contributions: [],
          missing_camera_ids: [],
          excluded_camera_ids: [],
        }),
      });
    if (pathname === "/metrics/establishment/summary") {
      const query = new URL(request.url).searchParams;
      const begin = query.get("start")!;
      const end = query.get("end")!;
      const length = Math.round((Date.parse(end) - Date.parse(begin)) / 86400000);
      const visitors = length === 1 ? 40 : length === 7 ? 457 : 900;
      const peak = length === 1 ? 18 : length === 7 ? 98 : 99;
      const days = Array.from({ length }, (_, index) => ({
        business_date: new Date(Date.parse(begin) + index * 86400000 + 8 * 3600000).toISOString().slice(0, 10),
        covered_ms: 86400000,
        qualified_observations: index === length - 1 ? visitors : 0,
        identification_state: "available",
        unique_count: index === length - 1 ? visitors : 0,
        peak_occupancy: index === length - 1 ? peak : 0,
        entries: index === length - 1 ? visitors + 10 : 0,
        exits: index === length - 1 ? visitors - 5 : 0,
        movement_state: "available",
      }));
      return mlResponse({
        status: 200,
        body: JSON.stringify({
          enterprise_id: enterpriseUser.enterpriseId,
          from_at: begin,
          to_at: end,
          days,
          days_available: length,
          days_requested: length,
          unique_count: visitors,
          confirmed_unique_count: visitors,
          entries: visitors + 10,
          exits: visitors - 5,
          peak_occupancy: peak,
          reconciliation_state: "estimated",
          movement_state: "available",
          identification_state: "available",
          coverage_ratio: 1,
          unresolved_observations: 0,
          source_breakdown: [],
        }),
      });
    }
    if (pathname === "/metrics/establishment/hourly") {
      const query = new URL(request.url).searchParams;
      return mlResponse({
        status: 200,
        body: JSON.stringify({
          enterprise_id: enterpriseUser.enterpriseId,
          from_at: query.get("start"),
          to_at: query.get("end"),
          timezone: "Asia/Manila",
          days_requested: 1,
          days_retained: 1,
          state: "available",
          hours: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            entries: hour === 14 ? 9 : 0,
            area_visits: 0,
            peak_occupancy: hour === 14 ? 18 : hour === 10 ? 6 : null,
            covered_ms: 3600000,
          })),
        }),
      });
    }
    if (pathname === "/reports/local")
      return mlResponse({
        status: 200,
        body: JSON.stringify(
          Array.from({ length: reportCount }, (_, index) => ({
            ...localReport,
            report_id: reportCount === 1 ? localReport.report_id : "REP-HISTORY-" + index,
            submitted_at: new Date(Date.UTC(2026, 6, 29 - index, 8)).toISOString(),
          })),
        ),
      });
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Unavailable in unified metrics acceptance test" }) });
  });

  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(enterpriseUser.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise metrics password 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
}

test("matches the dashboard arrangement and keeps periods, assistant, navigation and responsive layout functional", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await switchTheme(page, "light");
  const header = page.locator("[data-unified-metrics-header]");
  await expect(header).toHaveCount(1);
  await expect(header.locator("[data-metric-segment]")).toHaveCount(4);
  const segment = (id: string) => header.locator(`[data-metric-segment="${id}"]`);
  await expect(header.locator("[data-metric-segment]")).toHaveText([/Cameras/, /Total Entries/, /Live Occupancy/, /Peak Occupancy/]);
  await expect(segment("occupancy").getByText("12", { exact: true })).toBeVisible();
  await expect(segment("entries").getByText("50", { exact: true })).toBeVisible();
  await expect(segment("occupancy")).toContainText("current visitor inside");
  await expect(segment("peak")).toContainText("highest visitor record");
  await expect(segment("peak").getByText("18", { exact: true })).toBeVisible();
  await expect(segment("peak")).toContainText("From 2 to 4 PM");
  await expect(page.getByRole("heading", { name: "Visitor Traffic", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monitored Locations", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Reports", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Occupancy Trend" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Demographic Breakdown" })).toHaveCount(0);
  // The whole dashboard fits the window, with Recent Reports under Visitor Traffic and Monitored
  // Locations: the page itself does not scroll.
  const below = async (upper: string, lower: string) =>
    (await page.locator(lower).boundingBox())!.y >= (await page.locator(upper).boundingBox())!.y + (await page.locator(upper).boundingBox())!.height - 1;
  expect(await below(".dash-traffic", ".dash-reports")).toBe(true);
  expect(await below(".dash-locations", ".dash-reports")).toBe(true);
  const pageOverflow = () => page.locator(".enterprise-content").evaluate((element) => element.scrollHeight - element.clientHeight);
  for (const [width, height] of [[1440, 1024], [1920, 983], [1600, 811]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(pageOverflow).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.screenshot({ path: testInfo.outputPath("dashboard-collapsed-1440.png"), fullPage: true });
  // The open date picker sits above everything after the header, so no text shows through it.
  await page.getByRole("button", { name: /^Dashboard date range/ }).click();
  const popover = (await page.locator(".dash-date-popover").boundingBox())!;
  for (const [x, y] of [
    [popover.x + 40, popover.y + popover.height - 24],
    [popover.x + popover.width - 40, popover.y + popover.height - 24],
    [popover.x + 40, popover.y + popover.height / 2],
  ]) {
    expect(await page.evaluate(([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest(".dash-date-popover")), [x, y])).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".dash-date-popover")).toHaveCount(0);
  await selectDashboardPeriod(page, "Month");
  await expect(segment("entries").getByText("910", { exact: true })).toBeVisible();
  await expect(segment("peak").getByText("99", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to present" })).toBeVisible();
  await selectDashboardPeriod(page, "Week");
  await expect(segment("entries").getByText("467", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open TANAW Insights" }).click();
  const assistant = page.getByRole("complementary", { name: "TANAW Insights" });
  await expect(assistant).toBeVisible();
  await assistant.getByRole("button", { name: "Which day had the most visitors this week?" }).click();
  await expect(assistant.getByRole("log")).toContainText("was the busiest day in the past 7 days, with about 457 visitors.");
  await assistant.getByRole("textbox").fill("Pinakang busy ng establishment today?");
  await assistant.getByRole("button", { name: "Send message" }).click();
  await expect(assistant.getByRole("log")).toContainText("Pinaka-busy ngayong araw bandang 2:00–3:00 PM, na may hanggang 18 tao sa loob nang sabay-sabay.");
  await expect(assistant.getByRole("button", { name: "Ilan ang bisita ngayong araw?" })).toBeVisible();
  await assistant.getByRole("button", { name: "Tagalog" }).click();
  await expect(assistant.getByRole("button", { name: "Tagalog" })).toHaveAttribute("aria-pressed", "true");
  // Dragged as wide as it goes, the panel stops just past the end of the Live Occupancy text.
  const handle = page.getByRole("separator", { name: "Resize TANAW Insights" });
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(40, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  const occupancyTextEnd = await segment("occupancy").evaluate((element) => {
    let right = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      right = Math.max(right, range.getBoundingClientRect().right);
    }
    return right;
  });
  await expect.poll(async () => Math.abs((await assistant.boundingBox())!.x - (occupancyTextEnd + 20))).toBeLessThanOrEqual(1);
  await handle.press("End");
  await assistant.getByRole("button", { name: "Auto" }).click();
  await assistant.getByRole("textbox").fill("Tell me about my reports");
  await assistant.getByRole("button", { name: "Send message" }).click();
  await expect(assistant.getByRole("log")).toContainText("July 2026");
  await page.screenshot({ path: testInfo.outputPath("dashboard-expanded-1440.png"), fullPage: true });
  await page.getByRole("button", { name: "Collapse TANAW Insights" }).click();
  for (const width of [1024, 760, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator(".overview-main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.getByRole("link", { name: "View All" }).click();
  await expect(page).toHaveURL(/enterprise\/reports/);
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
});

for (const count of [0, 1, 5, 7]) {
  test(`shows only the latest of ${count} real reports under Visitor Traffic, never scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page, count);
    await expect.poll(() => page.locator(".enterprise-content").evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    const reports = page.locator(".dash-reports");
    if (!count) {
      await expect(reports.getByText("Submitted tourism reports will appear here.", { exact: true })).toBeVisible();
      await expect(reports.getByRole("region", { name: "Recent report list" })).toHaveCount(0);
      return;
    }
    const list = reports.getByRole("region", { name: "Recent report list" });
    // One report, the latest; every report is a click away under View all.
    await expect(list.getByRole("button")).toHaveCount(1);
    expect(await list.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    await expect(reports.getByRole("link", { name: /View all/ })).toBeVisible();
    await expect(reports.getByRole("button", { name: /Next submitted report|Previous submitted report/ })).toHaveCount(0);
    await list.getByRole("button").last().click();
    await expect(page.getByRole("dialog", { name: "Review Report Form", exact: true })).toBeVisible();
  });
}
