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

async function expectUnderlineUnder(indicator: Locator, tab: Locator) {
  await expect(indicator).toBeVisible();
  const target = (await tab.locator("[data-topbar-label]").boundingBox())!;
  await expect.poll(async () => {
    const underline = (await indicator.boundingBox())!;
    return Math.abs(underline.x + underline.width / 2 - target.x - target.width / 2) + Math.abs(underline.y - target.y - target.height - 4) + Math.abs(underline.width - target.width * 0.8);
  }).toBeLessThan(2);
}

test("compactly presents Activity History metrics above its search", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPortal(page, "admin", "light");

  await page.goto("/admin/activity-history");
  const summary = page.getByRole("region", { name: "Activity history summary" });
  for (const label of ["Today", "Report Updates", "Admin Activity", "Important Updates"]) {
    await expect(summary.getByText(label, { exact: true })).toBeVisible();
  }
  const search = page.getByPlaceholder("Search activity, name, affected item, or details");
  const bounds = (await summary.boundingBox())!;
  expect(bounds.height).toBeLessThan(86);
  expect(bounds.y + bounds.height).toBeLessThan((await search.boundingBox())!.y);

  await page.goto("/admin/operations");
  await expectUnifiedHeader(page.locator("[data-unified-metrics-header]"), ["Needs Attention", "Busy Establishments", "Escalated Support", "Account Requests"]);
  await expect(page.getByRole("link", { name: "Open Live Map" })).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "Current Work" })).toBeVisible();
  for (const category of ["Technical Issues", "Support Requests", "Account Requests", "Email Problems"]) {
    await expect(page.getByRole("link", { name: new RegExp(category) })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Desktop Application Status" })).toBeVisible();
  await expect(page.getByText("2 online, 1 delayed, and 4 offline.", { exact: true })).toBeVisible();
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByText("Delayed", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account Directory" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Accounts" })).toBeVisible();
  await expect(page.locator(".tanaw-it-health-card")).not.toHaveCSS("background-color", "rgb(255, 255, 255)");

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

test("keeps IT dropdown navigation keyboard-accessible and reduced-motion safe", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockPortal(page, "it", "dark");
  await page.goto("/it/dashboard");

  const overview = page.getByRole("link", { name: "Overview" });
  const workCenter = page.getByRole("link", { name: "Work Center" });
  const accounts = page.getByRole("button", { name: "Accounts" });
  const underline = page.locator("[data-topbar-underline]");
  await expectUnderlineUnder(underline, overview);
  await expect(underline).toHaveCSS("transition-property", "none");

  await workCenter.focus();
  await expect(workCenter).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(accounts).toBeFocused();
  await accounts.press("Enter");
  await expect(accounts).toHaveAttribute("aria-expanded", "true");
  const personnel = page.getByRole("link", { name: "LGU Personnel" });
  await expect(personnel).toBeVisible();
  await expect(page.getByRole("link", { name: "Enterprises", exact: true })).toBeVisible();
  await expectUnderlineUnder(underline, overview);

  await page.keyboard.press("Tab");
  await expect(personnel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/it\/lgu-accounts$/);
  await expect(accounts).toHaveAttribute("aria-current", "true");
  await expectUnderlineUnder(underline, accounts);
});

test("keeps the IT underline selection through hover, history, reload and mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockPortal(page, "it", "dark");
  await page.goto("/it/dashboard");

  const navigation = page.locator("nav[data-topbar-underline-navigation]:visible");
  const overview = navigation.getByRole("link", { name: "Overview" });
  const workCenter = navigation.getByRole("link", { name: "Work Center" });
  const system = navigation.getByRole("button", { name: "System", exact: true });
  const underline = navigation.locator("[data-topbar-underline]");
  await expectUnderlineUnder(underline, overview);
  await workCenter.hover();
  await expect(workCenter).toHaveCSS("color", "rgb(158, 241, 200)");
  await expectUnderlineUnder(underline, overview);

  await system.click();
  const settings = page.getByRole("link", { name: "System Settings" });
  await settings.hover();
  await settings.click();
  await expect(page).toHaveURL(/\/it\/settings\/system$/);
  await expect(system).toHaveAttribute("aria-current", "true");
  await expectUnderlineUnder(underline, system);

  await page.goBack();
  await expectUnderlineUnder(underline, overview);
  await page.goForward();
  await expectUnderlineUnder(underline, system);
  await page.reload();
  await expectUnderlineUnder(underline, system);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(settings).toHaveAttribute("aria-current", "page");
  await expectUnderlineUnder(underline, settings);
});

test("keeps Staff Reporting Period accessible and shows the monthly generation state", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPortal(page, "staff", "light");
  await page.route("**/operational/reports/enterprises", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "archie", name: "Archie's Event Place", category: "Events Place", barangay: "Landayan", complianceOwner: "Archie" },
        { id: "balon", name: "Balon ni Lolo Uweng", category: "Attraction", barangay: "Landayan", complianceOwner: "Balon" },
        { id: "golf", name: "Hallow Ridge Filipinas Golf Inc.", category: "Attraction", barangay: "Nueva", complianceOwner: "Hallow" },
      ]),
    }),
  );
  await page.route("**/operational/reports/intake", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "report-archie",
          enterpriseId: "archie",
          enterprise: "Archie's Event Place",
          category: "Events Place",
          barangay: "Landayan",
          month: "August",
          period: "August 2026",
          submitted: "2026-08-05T08:00:00Z",
          submittedAt: "2026-08-05T08:00:00Z",
          status: "Consolidated",
          code: "REP-ARCHIE",
          metrics: { entry: 680, exit: 620, unique: 455, peak: "11:00 AM" },
        },
        {
          id: "report-golf",
          enterpriseId: "golf",
          enterprise: "Hallow Ridge Filipinas Golf Inc.",
          category: "Attraction",
          barangay: "Nueva",
          month: "August",
          period: "August 2026",
          submitted: "2026-08-07T08:00:00Z",
          submittedAt: "2026-08-07T08:00:00Z",
          status: "Ready to Consolidate",
          code: "REP-GOLF",
          metrics: { entry: 990, exit: 900, unique: 690, peak: "2:00 PM" },
        },
      ]),
    }),
  );

  await page.goto("/staff/analytics");
  const analyticsHeader = page.locator("[data-unified-metrics-header]");
  await expectUnifiedHeader(analyticsHeader, ["Total Aggregated Entries", "Estimated Daily Visitors", "Reports Compliance"], 3);
  const reportingPeriod = page.getByRole("combobox", { name: "Reporting period" });
  await expect(reportingPeriod).toBeVisible();
  await reportingPeriod.click();
  await page.getByRole("option", { name: "August 2026", exact: true }).click();
  await reportingPeriod.focus();
  await expect(analyticsHeader.locator(".tanaw-unified-metrics__segment").last().locator(".tanaw-unified-metrics__hover")).toHaveCSS("opacity", "1");
  await expect(page.getByText("Enterprise Traffic Comparison", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Horizontal grouped bar chart comparing Total Entries and Unique Pax by enterprise" })).toBeVisible();
  await expect(page.getByText("Compare Total Entries and Unique Pax for every registered enterprise.")).toBeVisible();
  await expect(page.locator(".tanaw-traffic-card .recharts-bar")).toHaveCount(2);
  await expect(page.locator(".tanaw-traffic-card .recharts-scatter")).toHaveCount(0);
  const comparisonTable = page.getByRole("table", { name: "Enterprise Traffic Comparison data" });
  await expect(comparisonTable.getByRole("row", { name: "Archie's Event Place 680 455" })).toHaveCount(1);
  await expect(comparisonTable.getByRole("row", { name: "Balon ni Lolo Uweng 0 0" })).toHaveCount(1);
  await expect(page.getByText("Enterprise Traffic Comparison data", { exact: true })).not.toBeVisible();
  await expect(page.getByText("1 of 2 reports complete", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 1 reports complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Landayan report completion" })).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByRole("progressbar", { name: "Nueva report completion" })).toHaveAttribute("aria-valuenow", "100");

  await page.setViewportSize({ width: 1100, height: 820 });
  const trafficBox = await page.locator(".tanaw-traffic-card").boundingBox();
  const complianceBox = await page.locator(".tanaw-compliance-panel").boundingBox();
  expect(trafficBox).not.toBeNull();
  expect(complianceBox).not.toBeNull();
  expect(complianceBox!.y).toBeGreaterThan(trafficBox!.y + trafficBox!.height - 2);

  await page.goto("/staff/batch-reports?month=August&year=2026&barangay=Nueva");
  const generation = page.getByRole("region", { name: "Monthly report", exact: true });
  await expect(generation.getByText("August 2026 · Nueva")).toBeVisible();
  const generate = generation.getByRole("button", { name: "Generate monthly report" });
  await expect(generate).toBeEnabled();
  await expect(generate).toBeInViewport({ ratio: 1 });
  await page.getByRole("tab", { name: /^Ready/ }).click();
  await expect(page.getByRole("button", { name: "View report for Hallow Ridge Filipinas Golf Inc." })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("batch-reports-ready-light.png"), animations: "disabled" });
});
