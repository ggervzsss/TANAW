import { expect, test, type Locator, type Page } from "@playwright/test";

type PortalRole = "admin" | "it" | "staff";
type Theme = "dark" | "light";

const telemetrySummary = {
  enterpriseCount: 7,
  onlineGateways: 2,
  delayedGateways: 1,
  offlineGateways: 4,
  totalCurrentOccupancy: 12,
  totalEntries: 677,
  totalExits: 665,
  totalUniqueCount: 457,
  activeReports: 3,
  pendingReports: 3,
  lastSyncAt: "2026-07-29T07:09:00Z",
};

function createPortalUser(role: PortalRole) {
  return {
    id: `${role}-unified-metrics`,
    email: `${role}.metrics@example.test`,
    displayName: role === "it" ? "IT Personnel" : role === "staff" ? "LGU Staff" : "LGU Admin",
    role,
    title: role === "it" ? "IT Personnel" : role === "staff" ? "LGU Staff" : "LGU Admin",
    phone: null,
    firstName: "Unified",
    lastName: "Metrics",
    enterpriseId: null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    buildingCapacity: 100,
    displayImageDataUrl: null,
  };
}

async function mockPortal(page: Page, role: PortalRole, theme: Theme) {
  const user = createPortalUser(role);
  await page.addInitScript((nextTheme) => window.localStorage.setItem("tanaw-web-theme", nextTheme), theme);
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: `${role}-metrics-token`, user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/operational/telemetry/summary", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(telemetrySummary) }));

  for (const endpoint of [
    "**/operational/alerts",
    "**/operational/notifications",
    "**/operational/tickets",
    "**/operational/reports/enterprises",
    "**/operational/reports/intake",
    "**/operational/reports/final",
    "**/accounts/enterprises",
    "**/accounts/lgu",
    "**/accounts/email-deliveries",
    "**/activity-logs",
  ]) {
    await page.route(endpoint, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  }
}

async function expectUnifiedHeader(header: Locator, titles: string[], dividerCount = titles.length - 1) {
  await expect(header).toHaveCount(1);
  await expect(header.locator("[data-metrics-accent]")).toHaveCount(1);
  await expect(header.locator("[data-metric-segment]")).toHaveCount(titles.length);
  await expect(header.locator("[data-metric-divider]")).toHaveCount(dividerCount);
  await expect(header.locator(".tanaw-unified-metrics__scroller")).toHaveAttribute("tabindex", "0");
  for (const title of titles) await expect(header.getByText(title, { exact: true })).toBeVisible();

  const firstSegment = header.locator("[data-metric-segment]").first().locator(".tanaw-unified-metrics__segment");
  const beforeHover = await firstSegment.boundingBox();
  expect(beforeHover?.height).toBeGreaterThanOrEqual(158);
  await firstSegment.hover();
  await expect(firstSegment.locator(".tanaw-unified-metrics__hover")).toHaveCSS("opacity", "1");
  const afterHover = await firstSegment.boundingBox();
  expect(afterHover?.width).toBeCloseTo(beforeHover?.width ?? 0, 1);
  expect(afterHover?.height).toBeCloseTo(beforeHover?.height ?? 0, 1);
}

test("unifies Admin summary metrics without changing the surrounding pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPortal(page, "admin", "light");

  await page.goto("/admin/activity-history");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Today", "Report Updates", "Admin Activity", "Important Updates"]);
  await expect(page.getByPlaceholder("Search activity, name, affected item, or details")).toBeVisible();

  await page.goto("/admin/operations");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Needs Attention", "Busy Establishments", "Escalated Support", "Account Requests"]);
  await expect(page.getByRole("link", { name: "Open Live Map" })).toBeVisible();
});

test("unifies IT summary metrics in dark mode and preserves responsive overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockPortal(page, "it", "dark");

  await page.goto("/it/dashboard");
  const dashboardHeader = page.locator("[data-unified-metrics-header]");
  await expectUnifiedHeader(dashboardHeader, ["Urgent Issues", "Desktop Apps", "Support Requests", "Account Requests", "Email Problems"]);
  await expect(dashboardHeader).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dashboardHeader.locator(".tanaw-unified-metrics__icon").first()).toHaveCSS("transform", "none");

  for (const zoom of ["90%", "100%", "110%"]) {
    await page.evaluate((nextZoom) => {
      document.documentElement.style.zoom = nextZoom;
    }, zoom);
    const dimensions = await dashboardHeader.locator(".tanaw-unified-metrics__scroller").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.clientWidth).toBeGreaterThan(0);
    expect(dimensions.scrollWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "100%";
  });

  await page.goto("/it/work-center");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Needs Attention", "Urgent", "Working on It", "Resolved"]);
  await expect(page.getByPlaceholder("Search issue, enterprise, person, or suggested action")).toBeVisible();

  await page.goto("/it/work-center?view=support");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Open Requests", "High Priority", "Working on It", "With Photos"]);

  await page.goto("/it/lgu-accounts");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Active Accounts", "Admin Accounts", "IT Accounts", "Staff Accounts"]);
  await expect(page.getByRole("button", { name: "Create LGU Account" })).toBeVisible();

  await page.goto("/it/enterprise-accounts");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Enterprise Accounts", "Active Enterprises", "Inactive Enterprises", "Barangays Covered"]);
  await expect(page.getByRole("button", { name: "Register Enterprise" })).toBeVisible();
});

test("keeps Staff Reporting Period as a real control beside unified metrics", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPortal(page, "staff", "light");

  await page.goto("/staff/analytics");
  const analyticsHeader = page.locator("[data-unified-metrics-header]");
  await expectUnifiedHeader(analyticsHeader, ["Total Aggregated Entries", "Est. Unique People", "Reports Compliance"], 3);
  const reportingPeriod = page.getByRole("combobox", { name: "Reporting period" });
  await expect(reportingPeriod).toBeVisible();
  await reportingPeriod.focus();
  await expect(analyticsHeader.locator(".tanaw-unified-metrics__segment").last().locator(".tanaw-unified-metrics__hover")).toHaveCSS("opacity", "1");
  await expect(page.getByText("Enterprise Traffic Comparison", { exact: true })).toBeVisible();

  await page.goto("/staff/batch-reports");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Registered Enterprises", "Ready Reports", "Missing Submissions", "Archived Reports"]);
  await expect(page.getByRole("button", { name: "Generate Final Report" })).toBeVisible();
});
