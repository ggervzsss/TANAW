import { expect, test, type Page } from "@playwright/test";

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

const summary = {
  entries: 677,
  exits: 665,
  peak_occupancy: 61,
  current_occupancy: 12,
  unique_count: 457,
  estimated_unique_count: 457,
  confirmed_unique_count: 457,
  degraded_unique_count: 0,
  pending_unique_entries: 0,
  repeat_entry_count: 220,
  occupancy_correction_delta: 0,
  total_events: 1342,
  unsubmitted_events: 0,
  unsynced_events: 0,
  first_event_at: "2026-07-29T06:00:00Z",
  last_event_at: "2026-07-29T07:09:00Z",
  period: "2026-07",
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
  await page.route("http://127.0.0.1:8765/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/context/enterprise") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }),
      });
    }
    if (pathname === "/metrics/summary") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary) });
    if (pathname === "/metrics/history") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hourly_density: [], historical: { Today: [], Week: [], Month: [] } }),
      });
    }
    if (pathname === "/reports/local") return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Unavailable in unified metrics acceptance test" }) });
  });

  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(enterpriseUser.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise metrics password 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
}

test("renders the Enterprise analytics metrics as one responsive dark-mode header", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page);

  const header = page.locator("[data-unified-metrics-header]");
  await expect(header).toHaveCount(1);
  await expect(header.locator("[data-metrics-accent]")).toHaveCount(1);
  await expect(header.locator("[data-metric-segment]")).toHaveCount(3);
  await expect(header.locator("[data-metric-divider]")).toHaveCount(2);
  await expect(header.locator("[data-metric-segment] > div")).toHaveCount(3);
  await expect(header.getByText("Live Occupancy", { exact: true })).toBeVisible();
  await expect(header.getByText("Entry & Exit Flow", { exact: true })).toBeVisible();
  await expect(header.getByText("Unique Entries", { exact: true })).toBeVisible();
  await expect(header.getByText("12", { exact: true })).toBeVisible();
  await expect(header.getByText("457", { exact: true })).toBeVisible();
  await expect(header).not.toHaveCSS("background-color", "rgb(255, 255, 255)");

  const firstSegment = header.locator("[data-metric-segment]").first().locator(".tanaw-unified-metrics__segment");
  const beforeHover = await firstSegment.boundingBox();
  expect(beforeHover?.height).toBeGreaterThanOrEqual(158);
  await firstSegment.hover();
  await expect(firstSegment.locator(".tanaw-unified-metrics__hover")).toHaveCSS("opacity", "1");
  const afterHover = await firstSegment.boundingBox();
  expect(afterHover?.width).toBeCloseTo(beforeHover?.width ?? 0, 1);
  expect(afterHover?.height).toBeCloseTo(beforeHover?.height ?? 0, 1);

  for (const zoom of ["90%", "100%", "110%"]) {
    await page.evaluate((nextZoom) => {
      document.documentElement.style.zoom = nextZoom;
    }, zoom);
    const dimensions = await header.locator(".tanaw-unified-metrics__scroller").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.clientWidth).toBeGreaterThan(0);
    expect(dimensions.scrollWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
  }

  await page.evaluate(() => {
    document.documentElement.style.zoom = "100%";
  });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(header).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByText("Historical Visitor Trends", { exact: true })).toBeVisible();
});
