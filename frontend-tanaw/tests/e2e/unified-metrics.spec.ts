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
  await expect
    .poll(async () => {
      const underline = (await indicator.boundingBox())!;
      return Math.abs(underline.x + underline.width / 2 - target.x - target.width / 2) + Math.abs(underline.y - target.y - target.height - 4) + Math.abs(underline.width - target.width * 0.8);
    })
    .toBeLessThan(2);
}

const itDashboardMetrics = ["Urgent Issues", "Desktop Apps", "Support Requests", "Account Requests", "Email Problems"];

async function openItPage(page: Page, path: string) {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockPortal(page, "it", "dark");
  await page.goto(path);
  return page.locator("[data-unified-metrics-header]");
}

async function expectMetricsReachableAtZoom(page: Page, header: Locator, zoom: string) {
  await page.evaluate((nextZoom) => {
    document.documentElement.style.zoom = nextZoom;
  }, zoom);
  const scroller = header.locator(".tanaw-unified-metrics__scroller");
  // Scroll the way a person would. A script can scroll even overflow: hidden, a wheel cannot.
  await scroller.hover();
  await expect
    .poll(async () => {
      await page.mouse.wheel(400, 0);
      return scroller.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft);
    }, `${zoom} zoom: the metrics scroller reaches its end`)
    .toBeLessThanOrEqual(1);
  const layout = await scroller.evaluate((element) => {
    const segments = element.querySelectorAll("[data-metric-segment]");
    const last = segments[segments.length - 1]!.getBoundingClientRect();
    const visible = element.getBoundingClientRect();
    const header = element.closest("[data-unified-metrics-header]")!.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      headerLeft: header.left,
      headerRight: header.right,
      visibleLeft: visible.left,
      visibleRight: visible.right,
      lastLeft: last.left,
      lastRight: last.right,
      lastWidth: last.width,
    };
  });
  const context = `${zoom} zoom: ${JSON.stringify(layout)}`;
  // The page itself never scrolls sideways; only the metrics scroller may.
  expect(layout.pageOverflow, context).toBeLessThanOrEqual(0);
  expect(layout.headerLeft, context).toBeGreaterThanOrEqual(-1);
  expect(layout.headerRight, context).toBeLessThanOrEqual(layout.viewportWidth + 1);
  // The final metric can be brought fully into the scroller's visible area
  // (1 px allows for sub-pixel rounding at fractional zoom).
  expect(layout.lastWidth, context).toBeGreaterThan(0);
  expect(layout.lastLeft, context).toBeGreaterThanOrEqual(layout.visibleLeft - 1);
  expect(layout.lastRight, context).toBeLessThanOrEqual(layout.visibleRight + 1);
  await expect(header.getByText(itDashboardMetrics.at(-1)!, { exact: true })).toBeInViewport();
}

test("presents the IT dashboard metrics and status cards in dark mode", async ({ page }) => {
  const dashboardHeader = await openItPage(page, "/it/dashboard");
  await expectUnifiedHeader(dashboardHeader, itDashboardMetrics);
  await expect(dashboardHeader).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dashboardHeader.locator(".tanaw-unified-metrics__icon").first()).toHaveCSS("transform", "none");
  await expect(page.getByRole("heading", { name: "Current Work" })).toBeVisible();
  for (const category of ["Live Alerts", "Requests", "Account Changes", "Email Problems"]) {
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
});

for (const zoom of ["90%", "100%", "110%"]) {
  test(`keeps the IT dashboard within the viewport with every metric reachable at ${zoom} zoom`, async ({ page }) => {
    const dashboardHeader = await openItPage(page, "/it/dashboard");
    await expect(dashboardHeader.locator("[data-metric-segment]")).toHaveCount(itDashboardMetrics.length);
    await expectMetricsReachableAtZoom(page, dashboardHeader, zoom);
  });
}

test("unifies the IT Work Center request metrics", async ({ page }) => {
  const header = await openItPage(page, "/it/work-center");
  await expectUnifiedHeader(header, ["Open Requests", "Urgent", "In Progress", "Account Changes"]);
  await expect(page.getByPlaceholder("Search reference, place, person, request or group")).toBeVisible();
});

test("unifies the IT account directory metrics", async ({ page }) => {
  const header = await openItPage(page, "/it/lgu-accounts");
  await expectUnifiedHeader(header, ["Active Accounts", "Admin Accounts", "IT Accounts", "Staff Accounts"]);
  await expect(page.getByRole("button", { name: "Create LGU Account" })).toBeVisible();

  await page.goto("/it/enterprise-accounts");
  await expectUnifiedHeader(header, ["Enterprise Accounts", "Active Enterprises", "Inactive Enterprises", "Barangays Covered"]);
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
