import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";

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

async function signIn(page: Page) {
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
  await page.route("**/operational/tickets", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
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
    if (pathname === "/reports/local") return mlResponse({ status: 200, body: JSON.stringify([localReport]) });
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Unavailable in unified metrics acceptance test" }) });
  });

  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(enterpriseUser.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise metrics password 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
}

test("renders one responsive establishment header and updates its period consistently", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1024, height: 900 });
  await signIn(page);
  const header = page.locator("[data-unified-metrics-header]");
  await expect(header).toHaveCount(1);
  await expect(header.locator("[data-metric-segment]")).toHaveCount(4);
  await expect(header.locator("[data-metric-divider]")).toHaveCount(0);
  for (const title of ["Live Occupancy", "Unique Visitors", "Entry & Exit Flow", "Peak Occupancy"]) await expect(header.getByText(title, { exact: true })).toBeVisible();
  const segment = (id: string) => header.locator(`[data-metric-segment="${id}"]`);
  await expect(segment("occupancy").getByText("12", { exact: true })).toBeVisible();
  await expect(segment("visitors").getByText("457", { exact: true })).toBeVisible();
  await expect(segment("peak").getByText("98", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Week establishment visitor and peak occupancy history" })).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(segment("visitors").getByText("40", { exact: true })).toBeVisible();
  await expect(segment("flow").getByText("50 / 35", { exact: true })).toBeVisible();
  await expect(segment("peak").getByText("18", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "30 days", exact: true }).click();
  await expect(segment("visitors").getByText("900", { exact: true })).toBeVisible();
  await expect(segment("peak").getByText("99", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(segment("visitors").getByText("457", { exact: true })).toBeVisible();
  await expect(segment("occupancy").getByText("12", { exact: true })).toBeVisible();
  const donut = page.locator(".tanaw-demographics-chart .recharts-sector").first();
  await donut.hover();
  await expect(page.locator(".tanaw-demographics-chart").getByRole("status")).toBeVisible();
  const before = await segment("occupancy").boundingBox();
  await segment("occupancy").hover();
  const after = await segment("occupancy").boundingBox();
  expect(after?.width).toBeCloseTo(before?.width ?? 0, 1);
  expect(after?.height).toBeCloseTo(before?.height ?? 0, 1);
  for (const zoom of ["90%", "100%", "110%"]) {
    await page.evaluate((value) => {
      document.documentElement.style.zoom = value;
    }, zoom);
    const size = await header.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(size.width).toBeGreaterThan(0);
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "100%";
  });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(header).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByRole("heading", { name: "Establishment history", exact: true })).toBeVisible();
});
