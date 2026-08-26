import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const adminUser = {
  id: "admin-map-camera-test",
  email: "admin-map-camera@example.test",
  displayName: "LGU Admin",
  role: "admin",
  title: "Administrator Account",
  phone: null,
  firstName: "LGU",
  lastName: "Admin",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

const mapEnterprise = {
  id: "enterprise-map-camera-test",
  name: "Map Camera Test Enterprise",
  barangay: "San Antonio",
  category: "Attraction",
  fullAddress: "Barangay San Antonio, San Pedro, Laguna",
  lat: 14.352,
  lng: 121.035,
  totalLiveOccupancy: 12,
  estimatedUniqueCount: 24,
  monitoringStatus: "Fully Monitoring",
  occupancyStatus: "Normal",
  cameraMonitoring: {
    status: "running",
    configuredCameraCount: 1,
    activeCameraCount: 1,
    healthyCameraCount: 1,
    startingCameraCount: 0,
    stoppedCameraCount: 0,
    errorCameraCount: 0,
  },
};

const visitorInsights = {
  range: "7d",
  scopeType: "city",
  scopeId: null,
  scopeName: "San Pedro",
  currentVisitors: 12,
  typicalVisitors: null,
  differencePercent: null,
  comparisonMessage: "More matching days are needed before TANAW can make a reliable comparison.",
  busiestEnterprise: {
    enterpriseId: mapEnterprise.id,
    enterpriseName: mapEnterprise.name,
    barangay: mapEnterprise.barangay,
    currentVisitors: 12,
    typicalVisitors: null,
    differencePercent: null,
    activityLevel: "No Recent Baseline",
  },
  busiestPeriodLabel: "Sun, Aug 9",
  series: [
    { startAt: "2026-08-09T00:00:00+08:00", label: "Sun, Aug 9", averageVisitors: 4, peakVisitors: 6 },
    { startAt: "2026-08-10T00:00:00+08:00", label: "Mon, Aug 10", averageVisitors: 3, peakVisitors: 5 },
  ],
  unusuallyBusy: [],
  lastUpdatedAt: "2026-08-13T11:30:00+08:00",
};

type MapGeometry = {
  boundary: { bottom: number; centerX: number; height: number; left: number; right: number; top: number; width: number };
  directoryRight: number;
  map: { bottom: number; height: number; left: number; right: number; top: number; width: number };
  marker: { centerX: number; centerY: number };
};

async function configureAdminMapSession(page: Page, options: { theme?: "dark" | "light"; viewport?: { height: number; width: number } } = {}) {
  let signedIn = false;
  const theme = options.theme ?? "light";

  await page.setViewportSize(options.viewport ?? { width: 1920, height: 1080 });
  await page.addInitScript((initialTheme) => {
    window.localStorage.setItem("tanaw-web-theme", initialTheme);
  }, theme);
  await page.route(/https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: transparentPng }));
  await page.route("**/operational/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/activity-logs**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "map-camera-token", user: adminUser }) });
  });
  await page.route("**/auth/session", (route) => {
    if (!signedIn) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Not authenticated" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "map-camera-token", user: adminUser }) });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(adminUser) }));
  await page.route("**/auth/preferences", async (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/accounts/enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/map-enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([mapEnterprise]) }));
  await page.route("**/operational/visitor-insights**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(visitorInsights) }));

  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminUser.email);
  await page.getByLabel("Password", { exact: true }).fill("Map camera verification passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/mapview$/);
  await waitForMapReady(page);
}

async function waitForMapReady(page: Page) {
  const map = page.locator("#admin-enterprise-map");
  await expect(map).toBeVisible();
  await expect(map).toHaveCSS("visibility", "visible");
  await expect(page.locator("#admin-enterprise-map path.tanaw-boundary-path").first()).toBeVisible();
  await expect(page.locator("#admin-enterprise-map .leaflet-marker-icon").first()).toBeVisible();
  await page.waitForTimeout(350);
}

async function readMapGeometry(page: Page): Promise<MapGeometry> {
  return page.evaluate(() => {
    const mapElement = document.querySelector<HTMLElement>("#admin-enterprise-map");
    const directory = document.querySelector<HTMLElement>("#spatial-directory-panel");
    const marker = document.querySelector<HTMLElement>("#admin-enterprise-map .leaflet-marker-icon");
    const pathRects = Array.from(document.querySelectorAll<SVGPathElement>("#admin-enterprise-map path.tanaw-boundary-path"))
      .map((path) => path.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    if (!mapElement || !directory || !marker || pathRects.length === 0) {
      throw new Error("Admin map geometry is not ready.");
    }

    const map = mapElement.getBoundingClientRect();
    const directoryRect = directory.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const left = Math.min(...pathRects.map((rect) => rect.left));
    const right = Math.max(...pathRects.map((rect) => rect.right));
    const top = Math.min(...pathRects.map((rect) => rect.top));
    const bottom = Math.max(...pathRects.map((rect) => rect.bottom));

    return {
      boundary: {
        bottom,
        centerX: (left + right) / 2,
        height: bottom - top,
        left,
        right,
        top,
        width: right - left,
      },
      directoryRight: directoryRect.right,
      map: {
        bottom: map.bottom,
        height: map.height,
        left: map.left,
        right: map.right,
        top: map.top,
        width: map.width,
      },
      marker: {
        centerX: markerRect.left + markerRect.width / 2,
        centerY: markerRect.top + markerRect.height / 2,
      },
    };
  });
}

function expectCanonicalCitywideFraming(geometry: MapGeometry) {
  const usableCenterX = (geometry.directoryRight + geometry.map.right) / 2;
  const minimumBoundaryWidthRatio = geometry.map.width >= 1600 ? 0.35 : 0.25;

  expect(geometry.boundary.width).toBeGreaterThan(geometry.map.width * minimumBoundaryWidthRatio);
  expect(geometry.boundary.left).toBeGreaterThan(geometry.directoryRight + 24);
  expect(geometry.boundary.top).toBeGreaterThan(geometry.map.top + 30);
  expect(geometry.boundary.bottom).toBeLessThan(geometry.map.bottom - 30);
  expect(Math.abs(geometry.boundary.centerX - usableCenterX)).toBeLessThan(Math.max(90, geometry.map.width * 0.09));
}

function expectSameCamera(actual: MapGeometry, expected: MapGeometry) {
  expect(actual.boundary.left).toBeCloseTo(expected.boundary.left, 0);
  expect(actual.boundary.top).toBeCloseTo(expected.boundary.top, 0);
  expect(actual.boundary.width).toBeCloseTo(expected.boundary.width, 0);
  expect(actual.boundary.height).toBeCloseTo(expected.boundary.height, 0);
  expect(actual.marker.centerX).toBeCloseTo(expected.marker.centerX, 0);
  expect(actual.marker.centerY).toBeCloseTo(expected.marker.centerY, 0);
}

test("uses one canonical admin map camera for login, route return, refresh, and outside-click reset", async ({ page }) => {
  await configureAdminMapSession(page);
  const initial = await readMapGeometry(page);
  expectCanonicalCitywideFraming(initial);
  await expect(page.getByRole("combobox", { name: "Select barangay" })).toContainText("All Barangays");
  await expect(page.getByText("No Barangay Selected")).toHaveCount(0);
  await expect(page.getByText("All Enterprises", { exact: true })).toBeVisible();
  await expect(page.locator(".tanaw-map-directory__list").first()).toHaveCSS("scrollbar-width", "thin");

  const activityHistoryLink = page.getByRole("link", { name: "Activity History" });
  const operationsLink = page.getByRole("link", { name: "Operations Center" });
  const mapViewLink = page.getByRole("link", { name: "Map View" });
  const glassIndicator = page.locator("[data-topbar-glass-indicator='true']");
  const activeUnderline = mapViewLink.locator("[data-topbar-active-underline='true']");
  await expect(activeUnderline).toHaveCount(1);
  await expect(glassIndicator).toHaveCount(1);
  expect(await glassIndicator.getAttribute("data-topbar-glass-target")).toBeNull();
  await expect(glassIndicator).toHaveCSS("opacity", "0");
  await expect(page.locator("[data-topbar-active-surface], [data-topbar-liquid-layer], [data-topbar-liquid-bridge]")).toHaveCount(0);
  await mapViewLink.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "mapview");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-origin", "droplet-center");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-motion", "raf-spring");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-geometry", "continuous-capsule");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-shape", "continuous-waterdrop");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge", "replicated-lens-refraction");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-thickness", "feathered-lens-band");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-distortion", "motion-gated");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-band", "outer-14px");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-rest-optics", "clear");
  const refractiveEdge = glassIndicator.locator("[data-topbar-glass-refraction='background-adaptive']");
  await expect(refractiveEdge).toHaveCount(1);
  const refractionTrack = page.locator("[data-topbar-refraction-track='filtered-navigation-copy']");
  await expect(refractionTrack).toHaveCSS("filter", /tanaw-topbar-lens/);
  await expect(glassIndicator).toHaveCSS("border-top-width", "1px");
  await expect(glassIndicator).toHaveCSS("clip-path", "none");
  await expect(activeUnderline).toHaveCount(1);
  await page.waitForTimeout(480);
  const mapViewBox = await mapViewLink.boundingBox();
  const activityHistoryBox = await activityHistoryLink.boundingBox();
  expect(mapViewBox).not.toBeNull();
  expect(activityHistoryBox).not.toBeNull();
  await activityHistoryLink.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "activity-history");
  await page.waitForTimeout(260);
  const stretchedGlassBox = await glassIndicator.boundingBox();
  expect(stretchedGlassBox).not.toBeNull();
  const mapViewCenter = mapViewBox!.x + mapViewBox!.width / 2;
  const activityHistoryCenter = activityHistoryBox!.x + activityHistoryBox!.width / 2;
  const glidingCenter = stretchedGlassBox!.x + stretchedGlassBox!.width / 2;
  const fullUnionWidth = activityHistoryBox!.x + activityHistoryBox!.width - mapViewBox!.x;
  expect(glidingCenter).toBeGreaterThan(mapViewCenter);
  expect(glidingCenter).toBeLessThan(activityHistoryCenter);
  expect(stretchedGlassBox!.width).toBeLessThan(fullUnionWidth * 0.85);
  await expect(glassIndicator).toHaveCSS("border-radius", /px$/);
  await page.mouse.move((mapViewBox!.x + mapViewBox!.width + activityHistoryBox!.x) / 2, activityHistoryBox!.y + activityHistoryBox!.height / 2);
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "gap");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "gap:mapview:activity-history");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-deformation", "1.000");
  await expect(glassIndicator).toHaveCSS("border-radius", /px$/);
  await operationsLink.hover();
  const operationsGlass = glassIndicator;
  await expect(operationsGlass).toHaveAttribute("data-topbar-glass-target", "operations");
  await page.waitForTimeout(720);
  const operationsBox = await operationsLink.boundingBox();
  const operationsGlassBox = await operationsGlass.boundingBox();
  expect(operationsGlassBox!.x + operationsGlassBox!.width / 2).toBeCloseTo(operationsBox!.x + operationsBox!.width / 2, 0);
  await expect(operationsLink).not.toHaveCSS("transform", /matrix/);
  expect(Number.parseFloat(await operationsLink.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThan(14);
  await page.mouse.move(20, 180);
  await expect.poll(() => glassIndicator.getAttribute("data-topbar-glass-target")).toBeNull();
  await expect(glassIndicator).toHaveCSS("opacity", "0");
  await expect(activeUnderline).toHaveCount(1);
  await activityHistoryLink.focus();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "activity-history");
  await page.keyboard.press("Tab");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "operations");
  await activityHistoryLink.hover();
  await activityHistoryLink.click();
  await expect(page).toHaveURL(/\/admin\/activity-history$/);
  await expect(activityHistoryLink).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Activity History" })).toBeVisible();
  await expect(page.getByText("Loading TANAW workspace…")).toHaveCount(0);

  await mapViewLink.hover();
  await mapViewLink.click();
  await expect(page).toHaveURL(/\/admin\/mapview$/);
  await expect(mapViewLink).toHaveAttribute("aria-current", "page");
  await waitForMapReady(page);
  await expect(page.getByText("Loading TANAW workspace…")).toHaveCount(0);
  expectSameCamera(await readMapGeometry(page), initial);

  await page.getByRole("link", { name: "Operations Center" }).click();
  await expect(page).toHaveURL(/\/admin\/operations$/);
  await page.getByRole("link", { name: "Map View" }).click();
  await expect(page).toHaveURL(/\/admin\/mapview$/);
  await waitForMapReady(page);
  expectSameCamera(await readMapGeometry(page), initial);

  await page.reload();
  await waitForMapReady(page);
  expectSameCamera(await readMapGeometry(page), initial);

  const barangaySelect = page.getByRole("combobox", { name: "Select barangay" });
  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await expect(barangaySelect).toContainText("Barangay San Antonio");
  await page.waitForTimeout(900);
  const backToDirectory = page.getByRole("button", { name: "Back to Barangay Directory" });
  await expect(backToDirectory).toContainText("All Barangays");
  await expect(page.getByRole("heading", { name: "Barangay San Antonio" })).toBeVisible();
  await backToDirectory.click();
  await expect(barangaySelect).toContainText("All Barangays");
  await page.waitForTimeout(900);
  expectSameCamera(await readMapGeometry(page), initial);

  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await page.waitForTimeout(900);
  await barangaySelect.click();
  await page.getByRole("option", { name: /All Barangays/ }).click();
  await expect(barangaySelect).toContainText("All Barangays");
  await page.waitForTimeout(900);
  expectSameCamera(await readMapGeometry(page), initial);

  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await expect(barangaySelect).toContainText("Barangay San Antonio");
  await page.waitForTimeout(900);

  const map = page.locator("#admin-enterprise-map");
  const mapBox = await map.boundingBox();
  expect(mapBox).not.toBeNull();
  const sampledWidthsPromise = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const widths: number[] = [];
        const startedAt = performance.now();
        const sample = () => {
          const rects = Array.from(document.querySelectorAll<SVGPathElement>("#admin-enterprise-map path.tanaw-boundary-path"))
            .map((path) => path.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
          if (rects.length > 0) {
            widths.push(Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)));
          }
          if (performance.now() - startedAt < 950) {
            requestAnimationFrame(sample);
          } else {
            resolve(widths);
          }
        };
        sample();
      }),
  );
  await map.click({ position: { x: mapBox!.width - 72, y: mapBox!.height - 72 } });
  const sampledWidths = await sampledWidthsPromise;

  await expect(barangaySelect).toContainText("All Barangays");
  await expect(page.getByText("No Barangay Selected")).toHaveCount(0);
  await expect(page.getByText("All Enterprises", { exact: true })).toBeVisible();
  const reset = await readMapGeometry(page);
  expectSameCamera(reset, initial);
  expect(Math.min(...sampledWidths)).toBeGreaterThanOrEqual(reset.boundary.width * 0.98);
});

test("keeps the canonical citywide framing at laptop size in dark mode", async ({ page }) => {
  await configureAdminMapSession(page, {
    theme: "dark",
    viewport: { width: 1366, height: 768 },
  });

  expectCanonicalCitywideFraming(await readMapGeometry(page));
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("keeps the Spatial Directory readable, compact when retracted, and map-safe while balancing Enterprise Details", async ({ page }, testInfo) => {
  await configureAdminMapSession(page);

  const directory = page.locator("#spatial-directory-panel");
  const collapse = page.getByRole("button", { name: "Collapse spatial directory" });
  const openInsights = page.getByRole("button", { name: "Open visitor insights" });
  await expect(directory).toHaveAttribute("data-directory-state", "expanded");
  const expandedDirectoryBox = await directory.boundingBox();
  const collapseBox = await collapse.boundingBox();
  const initialInsightsBox = await openInsights.boundingBox();
  expect(expandedDirectoryBox).not.toBeNull();
  expect(collapseBox).not.toBeNull();
  expect(initialInsightsBox).not.toBeNull();
  expect(collapseBox!.y + collapseBox!.height / 2).toBeCloseTo(expandedDirectoryBox!.y + expandedDirectoryBox!.height / 2, 0);
  expect(initialInsightsBox!.x).toBeGreaterThan(1600);

  await page.locator(".tanaw-map-enterprise-card").filter({ hasText: "Map Camera Test Enterprise" }).click();
  const detailsDialog = page.getByRole("dialog", { name: mapEnterprise.name });
  await expect(detailsDialog).toBeVisible();
  await expect(detailsDialog.locator("[data-modal-top-accent='green-to-yellow']")).toHaveCount(1);
  await expect(detailsDialog.locator("[data-details-modal-layout='balanced-enterprise']")).toHaveCount(1);
  const contactCard = detailsDialog.getByText("Contact", { exact: true }).locator("..").locator("..");
  const hoursCard = detailsDialog.getByText("Operating Hours", { exact: true }).locator("..").locator("..");
  const addressCard = detailsDialog.getByText("Full Address", { exact: true }).locator("..").locator("..");
  const [contactBox, hoursBox, addressBox] = await Promise.all([contactCard.boundingBox(), hoursCard.boundingBox(), addressCard.boundingBox()]);
  expect(contactBox).not.toBeNull();
  expect(hoursBox).not.toBeNull();
  expect(addressBox).not.toBeNull();
  expect(hoursBox!.y).toBeCloseTo(contactBox!.y, 0);
  expect(addressBox!.y).toBeGreaterThan(contactBox!.y + contactBox!.height);
  expect(addressBox!.width).toBeGreaterThan(contactBox!.width * 1.8);
  await expect(detailsDialog.getByText("Not specified", { exact: true })).toBeVisible();
  await expect(detailsDialog.getByRole("button", { name: "View Visitor Insights" })).toBeVisible();
  await detailsDialog.getByRole("button", { name: "Close modal" }).click();

  await collapse.click();
  await expect(directory).toHaveAttribute("data-directory-state", "collapsed");
  await expect(directory).toHaveCSS("width", "0px");
  await expect(directory.locator(".tanaw-spatial-directory-shell")).toHaveCSS("opacity", "0");
  const expand = page.getByRole("button", { name: "Expand spatial directory" });
  await expect(expand).toBeVisible();
  await expect(openInsights).toBeVisible();
  await expect(expand).not.toContainText("Spatial Directory");
  await expect(openInsights).not.toContainText("Visitor Insights");
  await expect(expand).toHaveAttribute("title", "Spatial Directory");
  await expect(openInsights).toHaveAttribute("title", "Visitor Insights");
  await expect(expand).toHaveCSS("width", "52px");
  await expect(expand).toHaveCSS("height", "52px");
  const expandBox = await expand.boundingBox();
  const insightsBox = await openInsights.boundingBox();
  expect(expandBox).not.toBeNull();
  expect(insightsBox).not.toBeNull();
  expect(expandBox!.x).toBeLessThan(80);
  expect(insightsBox!.x).toBeGreaterThan(1600);
  expect(expandBox!.y).toBeCloseTo(insightsBox!.y, 0);
  expect(insightsBox!.x).toBeCloseTo(initialInsightsBox!.x, 0);
  expect(insightsBox!.y).toBeCloseTo(initialInsightsBox!.y, 0);
  expect(expandBox!.width).toBeCloseTo(insightsBox!.width, 0);
  await expect(page.locator("#admin-enterprise-map .leaflet-tile-loaded").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("collapsed-map-tool-rail.png"), fullPage: true });

  await expand.click();
  await expect(directory).toHaveAttribute("data-directory-state", "expanded");
  await expect(page.getByRole("heading", { name: "Barangay San Antonio" })).toBeVisible();
  await expect(directory).toHaveCSS("width", "408px");
  const restoredDirectoryBox = await directory.boundingBox();
  expect(restoredDirectoryBox!.width).toBeCloseTo(expandedDirectoryBox!.width, 0);
});

test("presents Visitor Insights as an accessible analytical workspace and highlights directory markers without changing map selection", async ({ page }, testInfo) => {
  await configureAdminMapSession(page);

  const marker = page.locator('#admin-enterprise-map .tanaw-map-pin[title="Map Camera Test Enterprise"]');
  const card = page.locator(".tanaw-map-enterprise-card").filter({ hasText: "Map Camera Test Enterprise" });
  await expect(marker.locator('.tanaw-enterprise-marker[data-tone="running"]')).toBeVisible();
  await expect(marker.locator(".tanaw-enterprise-marker__body svg")).toBeVisible();
  await expect(card).toHaveAttribute("aria-pressed", "false");

  await card.hover();
  await expect(marker).toHaveClass(/is-directory-hovered/);
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("heading", { name: "Spatial Directory" }).hover();
  await expect(marker).not.toHaveClass(/is-directory-hovered/);

  const openInsights = page.getByRole("button", { name: "Open visitor insights" });
  await expect(openInsights).not.toContainText("Visitor Insights");
  await openInsights.click();
  const insights = page.getByRole("complementary", { name: "Visitor insights" });
  await expect(insights).toBeVisible();
  await expect(insights.getByRole("heading", { name: "San Pedro" })).toBeVisible();
  await expect(insights.getByText("Visitors Right Now", { exact: true })).toBeVisible();
  await expect(insights.getByText("Learning", { exact: true })).toBeVisible();
  await expect(insights.getByText("Building a reliable comparison", { exact: true })).toBeVisible();
  await expect(insights.getByText("Activity Pattern", { exact: true })).toBeVisible();
  await expect(insights.getByText("Busiest Right Now", { exact: true })).toBeVisible();
  await expect(insights.getByText("Busiest Period", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("visitor-insights-light.png"), fullPage: true });

  const selectedRange = insights.getByRole("tab", { name: "7 Days" });
  await expect(selectedRange).toHaveAttribute("aria-selected", "true");
  await selectedRange.focus();
  await page.keyboard.press("ArrowRight");
  await expect(insights.getByRole("tab", { name: "30 Days" })).toHaveAttribute("aria-selected", "true");
  await insights.getByRole("button", { name: "Close visitor insights" }).click();
  await expect(openInsights).toBeVisible();
});

test("keeps the modernized Admin data workspaces semantic and keyboard operable", async ({ page }, testInfo) => {
  await configureAdminMapSession(page);

  await page.route("**/activity-logs**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "activity-modernization-1",
          timestamp: "2026-08-13T11:42:00+08:00",
          category: "Admin Operation",
          severity: "Success",
          actor: "LGU Admin",
          actorRole: "Admin",
          action: "Login",
          target: "admin@email.com",
          summary: "LGU Admin signed in to TANAW.",
          sourceId: null,
          metadata: {},
        },
        {
          id: "activity-modernization-2",
          timestamp: "2026-08-11T11:59:00+08:00",
          category: "Staff Submission",
          severity: "Info",
          actor: "LGU Staff",
          actorRole: "LGU Staff",
          action: "Submit Enterprise Report",
          target: "Archie's Event Place",
          summary: "LGU Staff submitted the latest establishment activity report for Admin review.",
          sourceId: null,
          metadata: {},
        },
      ]),
    }),
  );
  await page.route("**/operational/alerts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "alert-modernization-1",
          type: "Foot Traffic Alert",
          severity: "Critical",
          urgency: "Urgent",
          enterprise: "Archie's Event Place",
          requester: "System",
          summary: "Archie's Event Place currently has 68 visitors, compared with its usual 17 around this day and time.",
          requiredAction: "Review the live map and coordinate with the establishment, traffic team, or public-safety partners.",
          resolutionMode: "Admin Monitoring",
          status: "New",
          owner: "Admin",
          time: "2026-08-13T11:40:00+08:00",
        },
        {
          id: "alert-modernization-2",
          type: "Occupancy Spike",
          severity: "Warning",
          urgency: "Important",
          enterprise: "San Pedro Convention Hall",
          requester: "System",
          summary: "San Pedro Convention Hall is approaching its expected busy-period occupancy.",
          requiredAction: "Continue monitoring the establishment and confirm that entry controls are ready.",
          resolutionMode: "Admin Monitoring",
          status: "In Review",
          owner: "Admin",
          time: "2026-08-13T11:35:00+08:00",
        },
      ]),
    }),
  );

  await page.getByRole("link", { name: "Activity History" }).click();
  const auditWorkspace = page.locator(".tanaw-audit-workspace");
  await expect(auditWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Activity history summary" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search activity history" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter activity category" })).toContainText("All Activity");
  for (const heading of ["Date and Time", "Activity", "Performed By", "Affected Item", "Details"]) {
    await expect(auditWorkspace.getByRole("columnheader", { name: heading })).toBeVisible();
  }
  await expect(auditWorkspace.getByText("LGU Admin signed in to TANAW.").first()).toBeVisible();
  const activitySearch = page.getByRole("textbox", { name: "Search activity history" });
  await activitySearch.fill("Submit Enterprise Report");
  await expect(auditWorkspace.getByText("Submit Enterprise Report", { exact: true }).first()).toBeVisible();
  await expect(auditWorkspace.getByText("Login", { exact: true })).toHaveCount(0);
  await activitySearch.clear();
  await auditWorkspace.getByRole("row", { name: /View details for Login/ }).press("Enter");
  await expect(page.getByRole("dialog")).toContainText("LGU Admin signed in to TANAW.");
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("activity-history-light.png"), fullPage: true });

  await page.getByRole("link", { name: "Operations Center" }).click();
  const operationsWorkspace = page.locator(".tanaw-operations-workspace");
  await expect(operationsWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Operations Center summary" })).toBeVisible();
  await expect(operationsWorkspace.getByRole("region", { name: "Situation queue" })).toBeVisible();
  const situationDetails = operationsWorkspace.getByRole("region", { name: "Selected situation details" });
  for (const label of ["Establishment", "What Happened", "Urgency", "Status"]) await expect(situationDetails.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(operationsWorkspace.getByText("Archie's Event Place", { exact: true }).first()).toBeVisible();
  const secondSituation = operationsWorkspace.getByRole("button", { name: "Select Sudden Crowd Increase" });
  await secondSituation.focus();
  await page.keyboard.press("Enter");
  await expect(secondSituation).toHaveAttribute("aria-pressed", "true");
  await expect(situationDetails.getByText("San Pedro Convention Hall", { exact: true }).first()).toBeVisible();
  await situationDetails.getByRole("button", { name: "View situation details" }).click();
  await expect(page.getByRole("dialog")).toContainText("San Pedro Convention Hall");
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("operations-center-light.png"), fullPage: true });

  await page.setViewportSize({ width: 900, height: 900 });
  const [stackedQueueBox, stackedDetailsBox] = await Promise.all([
    operationsWorkspace.getByRole("region", { name: "Situation queue" }).boundingBox(),
    operationsWorkspace.getByRole("region", { name: "Selected situation details" }).boundingBox(),
  ]);
  expect(stackedQueueBox).not.toBeNull();
  expect(stackedDetailsBox).not.toBeNull();
  expect(stackedDetailsBox!.y).toBeGreaterThan(stackedQueueBox!.y + stackedQueueBox!.height);

  const situationsTab = operationsWorkspace.getByRole("tab", { name: "Needs Attention" });
  await situationsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(operationsWorkspace.getByRole("tab", { name: "Escalated Support" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(operationsWorkspace.getByRole("tab", { name: "Account Requests" })).toHaveAttribute("aria-selected", "true");
});

test("keeps Visitor Insights and Admin data workspaces intentionally layered in dark mode", async ({ page }, testInfo) => {
  await configureAdminMapSession(page, { theme: "dark", viewport: { width: 1366, height: 768 } });
  await page.getByRole("button", { name: "Open visitor insights" }).click();
  await expect(page.getByRole("complementary", { name: "Visitor insights" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("visitor-insights-dark.png"), fullPage: true });

  await page.getByRole("link", { name: "Activity History" }).click();
  await expect(page.locator(".tanaw-audit-workspace")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("activity-history-dark.png"), fullPage: true });

  await page.getByRole("link", { name: "Operations Center" }).click();
  await expect(page.locator(".tanaw-operations-workspace")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("operations-center-dark.png"), fullPage: true });
});

test("keeps only the latest barangay tooltip while rapidly switching selections", async ({ page }) => {
  await configureAdminMapSession(page);

  const barangaySelect = page.getByRole("combobox", { name: "Select barangay" });
  for (const barangay of ["San Antonio", "Landayan", "Pacita I"]) {
    await barangaySelect.click();
    await page.getByRole("option", { name: new RegExp(`^Barangay ${barangay} \\d+$`) }).click();
  }

  const visibleBoundaryTooltips = page.locator("#admin-enterprise-map .leaflet-tooltip");
  await expect(visibleBoundaryTooltips).toHaveCount(1);
  await expect(visibleBoundaryTooltips).toContainText("Pacita I");
  await expect(visibleBoundaryTooltips).not.toContainText("San Antonio");
  await expect(visibleBoundaryTooltips).not.toContainText("Landayan");
});
