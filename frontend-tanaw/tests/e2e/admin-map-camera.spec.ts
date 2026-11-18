import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import type { MapEnterprise } from "../../src/shared/types";

const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==", "base64");

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

const mapEnterprise: MapEnterprise = {
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
    { startAt: "2026-08-09T00:00:00+08:00", label: "Sun, Aug 9", averageVisitors: 4, peakVisitors: 6, estimatedUniqueCount: 24 },
    { startAt: "2026-08-10T00:00:00+08:00", label: "Mon, Aug 10", averageVisitors: 3, peakVisitors: 5, estimatedUniqueCount: 19 },
  ],
  unusuallyBusy: [],
  lastUpdatedAt: "2026-08-13T11:30:00+08:00",
};

type MapGeometry = {
  boundary: { bottom: number; centerX: number; height: number; left: number; right: number; top: number; width: number };
  directoryRight: number;
  map: { bottom: number; height: number; left: number; right: number; top: number; width: number };
  marker: { centerX: number; centerY: number };
  /** Every marker's center, keyed by its accessible name, so cameras compare the same establishment. */
  markers: Record<string, { centerX: number; centerY: number }>;
};

async function configureAdminMapSession(page: Page, options: { theme?: "dark" | "light"; viewport?: { height: number; width: number }; enterprises?: MapEnterprise[] } = {}) {
  let signedIn = false;
  const theme = options.theme ?? "light";

  await page.setViewportSize(options.viewport ?? { width: 1920, height: 1080 });
  await page.addInitScript((initialTheme) => {
    if (!window.localStorage.getItem("tanaw-web-theme")) window.localStorage.setItem("tanaw-web-theme", initialTheme);
  }, theme);
  await page.route(/https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/, (route) => {
    expect(new URL(route.request().url()).searchParams.get("key")).toBe("carto-e2e-test-key");
    return route.fulfill({ status: 200, contentType: "image/png", body: transparentPng });
  });
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
  await page.route("**/operational/map-enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(options.enterprises ?? [mapEnterprise]) }));
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

/** Reads the map once the camera and markers have stopped moving, so an easing camera is never compared. */
async function readSettledMapGeometry(page: Page): Promise<MapGeometry> {
  let previous = await readMapGeometry(page);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(100);
    const current = await readMapGeometry(page);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  return previous;
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
      markers: Object.fromEntries(
        Array.from(document.querySelectorAll<HTMLElement>("#admin-enterprise-map .leaflet-marker-icon[aria-label]")).map((element) => {
          const rect = element.getBoundingClientRect();
          return [element.getAttribute("aria-label")!, { centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 }];
        }),
      ),
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
  // Markers are re-added when filters change, so the first marker can be another establishment.
  const shared = Object.keys(expected.markers).filter((label) => label in actual.markers);
  expect(shared.length).toBeGreaterThan(0);
  for (const label of shared) {
    expect(actual.markers[label].centerX, label).toBeCloseTo(expected.markers[label].centerX, 0);
    expect(actual.markers[label].centerY, label).toBeCloseTo(expected.markers[label].centerY, 0);
  }
}

test("keeps the tile grid, boundary renderer, and pin together in every animated zoom frame", async ({ page }) => {
  await configureAdminMapSession(page, { theme: "dark", viewport: { width: 1366, height: 768 } });
  const map = page.locator("#admin-enterprise-map");
  const base = map.locator(".tanaw-base-tiles--dark");
  await expect(base.locator(".leaflet-tile-loaded").first()).toBeVisible();

  for (const direction of ["in", "out"]) {
    const frames = map.evaluate((container) => {
      const renderer = container.querySelector<SVGSVGElement>(".leaflet-boundary-pane svg")!;
      const pin = container.querySelector<HTMLElement>(".tanaw-map-pin")!;
      const tiles = container.querySelector(".tanaw-base-tiles--dark")!;
      const level = tiles.querySelector(".leaflet-tile-container:has(.leaflet-tile-loaded)")!;
      const mapPane = container.querySelector(".leaflet-map-pane")!;
      const matrix = (element: Element) => new DOMMatrixReadOnly(getComputedStyle(element).transform === "none" ? undefined : getComputedStyle(element).transform);
      const svgScale = matrix(renderer).a;
      const tileScale = matrix(level).a;
      const pinRect = pin.getBoundingClientRect();
      const origin = new DOMPoint(pinRect.x + 25, pinRect.y + 49).matrixTransform(renderer.getScreenCTM()!.inverse());
      const levelCount = tiles.children.length;
      return new Promise<{ scaleDifference: number; pinError: number; incomingLevel: boolean }[]>((resolve) => {
        const samples: { scaleDifference: number; pinError: number; incomingLevel: boolean }[] = [];
        // Sample the whole zoom animation, however long the click takes to start it.
        const deadline = performance.now() + 5000;
        let started = false;
        const sample = () => {
          const animating = mapPane.classList.contains("leaflet-zoom-anim");
          if (animating) {
            started = true;
            const expectedPin = origin.matrixTransform(renderer.getScreenCTM()!);
            const rect = pin.getBoundingClientRect();
            samples.push({
              scaleDifference: Math.abs(matrix(renderer).a / svgScale - matrix(level).a / tileScale),
              pinError: Math.hypot(rect.x + 25 - expectedPin.x, rect.y + 49 - expectedPin.y),
              incomingLevel: tiles.children.length > levelCount,
            });
          }
          if ((started && !animating) || performance.now() >= deadline) resolve(samples);
          else requestAnimationFrame(sample);
        };
        sample();
      });
    });
    await map.locator(`.leaflet-control-zoom-${direction}`).click();
    const samples = await frames;
    // A 250 ms zoom can render as little as one frame in headless Chrome on a busy machine;
    // every frame that does render is checked below.
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map((sample) => sample.scaleDifference))).toBeLessThan(0.025);
    expect(Math.max(...samples.map((sample) => sample.pinError))).toBeLessThan(4);
    expect(samples.some((sample) => sample.incomingLevel)).toBe(false);
  }
});

test("switches between enterprise previews, reports missing telemetry, and keeps both panel controls responsive", async ({ page }, testInfo) => {
  const offlineEnterprise: MapEnterprise = {
    ...mapEnterprise, id: "offline-enterprise", name: "Offline Enterprise", lng: mapEnterprise.lng + 0.006,
    monitoringStatus: "Offline", occupancyStatus: "No Data", totalLiveOccupancy: null, cameraMonitoring: null,
  };
  await configureAdminMapSession(page, { theme: "dark", enterprises: [mapEnterprise, offlineEnterprise] });
  const card = page.locator(".tanaw-map-enterprise-card").filter({ hasText: mapEnterprise.name });
  const other = page.locator(".tanaw-map-enterprise-card").filter({ hasText: offlineEnterprise.name });
  const marker = page.locator(".tanaw-map-pin").filter({ has: page.locator(".tanaw-enterprise-marker[data-tone='stopped']") });
  const preview = page.getByRole("region", { name: "Enterprise preview" });
  await card.click();
  await expect(preview).toContainText(mapEnterprise.name);
  const firstCamera = await readSettledMapGeometry(page);
  await card.click();
  expectSameCamera(await readSettledMapGeometry(page), firstCamera);
  await other.click();
  await expect(preview).toContainText(offlineEnterprise.name);
  await expect(preview).toContainText("Offline");
  await expect(preview.getByText("Unavailable", { exact: true })).toHaveCount(2);
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(marker).toHaveClass(/is-selected/);
  await expect(page.locator(".tanaw-enterprise-popup .leaflet-popup-content-wrapper")).toHaveCSS("background-color", "rgb(25, 41, 37)");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const selectedCamera = await readSettledMapGeometry(page);
  const insightsToggle = page.locator("#visitor-insights-launcher");
  const directoryToggle = page.locator("#spatial-directory-toggle");
  const left = (await directoryToggle.boundingBox())!;
  const right = (await insightsToggle.boundingBox())!;
  expect(left.y).toBeCloseTo(right.y, 0);
  expect(left.width).toBe(right.width);
  await insightsToggle.click();
  await insightsToggle.click();
  await insightsToggle.click();
  await directoryToggle.click();
  await directoryToggle.click();
  await expect(insightsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(directoryToggle).toHaveAttribute("aria-expanded", "true");
  const insightsPanel = page.getByRole("complementary", { name: "Visitor insights" });
  await expect(insightsPanel).toHaveCSS("opacity", "1");
  const zoomButton = (await page.locator(".leaflet-control-zoom-in").boundingBox())!;
  expect(zoomButton.x + zoomButton.width).toBeLessThan((await insightsPanel.boundingBox())!.x);
  expectSameCamera(await readSettledMapGeometry(page), selectedCamera);
  await page.screenshot({ path: testInfo.outputPath("enterprise-preview-dark.png") });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator(".tanaw-enterprise-popup .leaflet-popup-content-wrapper")).toHaveCSS("background-color", "rgb(248, 252, 250)");
  expectSameCamera(await readSettledMapGeometry(page), selectedCamera);
});

test("keeps a panned preview inside the viewport and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureAdminMapSession(page, { viewport: { width: 820, height: 680 } });
  const map = page.locator("#admin-enterprise-map");
  const marker = map.locator(".tanaw-map-pin");
  await marker.click();
  const popup = map.locator(".tanaw-enterprise-popup");
  await expect(popup).toBeVisible();
  await expect(marker.locator(".tanaw-enterprise-marker__selection")).toHaveCSS("animation-name", "none");
  await expect(page.locator("#visitor-insights-panel")).toHaveCSS("transition-property", "none");
  const geometry = await readMapGeometry(page);

  const start = { x: geometry.marker.centerX + 46, y: geometry.marker.centerY + 60 };
  const offset = {
    x: geometry.map.left + 45 - geometry.marker.centerX,
    y: geometry.map.top + 54 - geometry.marker.centerY,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + offset.x, start.y + offset.y, { steps: 16 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(popup).toHaveAttribute("data-placement", "below");
  const previewBounds = (await popup.boundingBox())!;
  expect(previewBounds.x).toBeGreaterThanOrEqual(geometry.map.left + 10);
  expect(previewBounds.x + previewBounds.width).toBeLessThan(geometry.map.right);
  expect(previewBounds.y + previewBounds.height).toBeLessThan(geometry.map.bottom);
  await expect(popup.getByRole("button", { name: "View Details" })).toBeVisible();
});

test("fits the city on entry and keeps the camera when filters are cleared", async ({ page }) => {
  test.setTimeout(60_000);
  await configureAdminMapSession(page);
  const initial = await readSettledMapGeometry(page);
  expectCanonicalCitywideFraming(initial);
  const allBarangays = page.getByRole("combobox", { name: "Select barangay" });
  await expect(allBarangays).toContainText("All Barangays");
  await expect(allBarangays.locator(".tanaw-directory-select-meta")).toHaveText("1");
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
  expectSameCamera(await readSettledMapGeometry(page), initial);

  await page.getByRole("link", { name: "Operations Center" }).click();
  await expect(page).toHaveURL(/\/admin\/operations$/);
  await page.getByRole("link", { name: "Map View" }).click();
  await expect(page).toHaveURL(/\/admin\/mapview$/);
  await waitForMapReady(page);
  expectSameCamera(await readSettledMapGeometry(page), initial);

  await page.reload();
  await waitForMapReady(page);
  expectSameCamera(await readSettledMapGeometry(page), initial);

  const barangaySelect = page.getByRole("combobox", { name: "Select barangay" });
  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await expect(barangaySelect).toContainText("Barangay San Antonio");
  await page.waitForTimeout(900);
  const backToDirectory = page.getByRole("button", { name: "Back to Barangay Directory" });
  await expect(backToDirectory).toContainText("All Barangays");
  await expect(page.getByRole("heading", { name: "Barangay San Antonio" })).toBeVisible();
  const filteredCamera = await readSettledMapGeometry(page);
  await backToDirectory.click();
  await expect(barangaySelect).toContainText("All Barangays");
  await page.waitForTimeout(900);
  expectSameCamera(await readSettledMapGeometry(page), filteredCamera);

  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await page.waitForTimeout(900);
  const dropdownCamera = await readSettledMapGeometry(page);
  await barangaySelect.click();
  await page.getByRole("option", { name: /All Barangays/ }).click();
  await expect(barangaySelect).toContainText("All Barangays");
  await page.waitForTimeout(900);
  expectSameCamera(await readSettledMapGeometry(page), dropdownCamera);

  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await expect(barangaySelect).toContainText("Barangay San Antonio");
  await page.waitForTimeout(900);
  const outsideClickCamera = await readSettledMapGeometry(page);

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
  const reset = await readSettledMapGeometry(page);
  expectSameCamera(reset, outsideClickCamera);
  expect(Math.min(...sampledWidths)).toBeGreaterThanOrEqual(reset.boundary.width * 0.98);
  await expect(page.getByRole("button", { name: "Fit all barangays" })).toHaveCount(0);
  await page.locator("#spatial-directory-panel").getByRole("button", { name: "Reset map view" }).click();
  await expect.poll(async () => Math.abs((await readMapGeometry(page)).boundary.left - initial.boundary.left)).toBeLessThan(1);
});

test("keeps dark-mode boundaries legible and fits a selected barangay beside the directory", async ({ page }, testInfo) => {
  await configureAdminMapSession(page, {
    theme: "dark",
    viewport: { width: 1366, height: 768 },
  });

  const initial = await readSettledMapGeometry(page);
  expectCanonicalCitywideFraming(initial);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("heading", { name: "Spatial Directory" }).hover();
  const map = page.locator("#admin-enterprise-map");
  await expect(map.locator(".tanaw-base-tiles--dark")).toHaveCSS("filter", /contrast\(0\.68\)/);
  await expect(map.locator('.tanaw-boundary-path[stroke="#96beaf"][stroke-width="2"][fill-opacity="0.22"]')).toHaveCount(28);
  await page.screenshot({ path: testInfo.outputPath("admin-map-dark.png") });

  await page.getByRole("combobox", { name: "Select barangay" }).click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  const selectedBoundary = map.locator('.tanaw-boundary-path[stroke="#abe6c9"]');
  await expect(selectedBoundary).toHaveAttribute("stroke-width", "3.25");
  await expect.poll(async () => (await readMapGeometry(page)).boundary.width).toBeGreaterThan(initial.boundary.width);
  await expect(map.locator(".leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const bounds = (await selectedBoundary.boundingBox())!;
  expect(bounds.x).toBeGreaterThan(initial.directoryRight + 30);
  expect(bounds.x + bounds.width).toBeLessThan(initial.map.right - 30);
  expect(bounds.y).toBeGreaterThan(initial.map.top + 30);
  expect(bounds.y + bounds.height).toBeLessThan(initial.map.bottom - 30);
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
  await expect(directory.locator(".tanaw-spatial-directory-shell")).toHaveCSS("backdrop-filter", "blur(9px) saturate(1.14)");
  expect(expandedDirectoryBox).not.toBeNull();
  expect(collapseBox).not.toBeNull();
  expect(initialInsightsBox).not.toBeNull();
  expect(collapseBox!.y - expandedDirectoryBox!.y).toBeLessThan(32);
  expect(collapseBox!.x - expandedDirectoryBox!.x).toBeLessThan(32);
  expect(initialInsightsBox!.x).toBeGreaterThan(1600);
  expect(initialInsightsBox!.y).toBeCloseTo(collapseBox!.y, 0);
  expect(initialInsightsBox!.width).toBe(collapseBox!.width);

  const enterpriseCard = directory.locator(".tanaw-map-enterprise-card").filter({ hasText: mapEnterprise.name });
  await expect(enterpriseCard).toContainText("Live Occupancy");
  await expect(enterpriseCard).toContainText("1/1 cameras reporting");
  await expect(enterpriseCard.getByText("Est. Unique", { exact: true })).toHaveCount(0);
  await enterpriseCard.click();
  const detailsDialog = page.getByRole("dialog", { name: mapEnterprise.name });
  const preview = page.getByRole("region", { name: "Enterprise preview" });
  await expect(preview).toBeVisible();
  await expect(detailsDialog).toHaveCount(0);
  await expect(preview).toContainText("1/1 reporting");
  const beforeDetails = await readSettledMapGeometry(page);
  await preview.getByRole("button", { name: "View Details" }).click();
  await expect(detailsDialog).toBeVisible();
  await expect(detailsDialog.locator("[data-dialog-accent='thread']")).toHaveCount(1);
  await expect(detailsDialog.locator("[data-details-modal-layout='balanced-enterprise']")).toHaveCount(1);
  const contactCard = detailsDialog.getByText("Contact", { exact: true }).locator("..").locator("..");
  const hoursCard = detailsDialog.getByText("Operating Hours", { exact: true }).locator("..").locator("..");
  const addressCard = detailsDialog.getByText("Full Address", { exact: true }).locator("..").locator("..");
  await expect.poll(async () => {
    const [contact, hours] = await Promise.all([contactCard.boundingBox(), hoursCard.boundingBox()]);
    return contact && hours ? Math.abs(contact.y - hours.y) : Infinity;
  }).toBeLessThan(0.5);
  const [contactBox, hoursBox, addressBox] = await Promise.all([contactCard.boundingBox(), hoursCard.boundingBox(), addressCard.boundingBox()]);
  expect(contactBox).not.toBeNull();
  expect(hoursBox).not.toBeNull();
  expect(addressBox).not.toBeNull();
  expect(hoursBox!.y).toBeCloseTo(contactBox!.y, 0);
  expect(addressBox!.y).toBeGreaterThan(contactBox!.y + contactBox!.height);
  expect(addressBox!.width).toBeGreaterThan(contactBox!.width * 1.8);
  await expect(detailsDialog.getByText("Not specified", { exact: true })).toBeVisible();
  await expect(detailsDialog.getByRole("button", { name: "View visitor insights" })).toBeVisible();
  await detailsDialog.getByRole("button", { name: "Close modal" }).click();
  await expect(detailsDialog).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "View Details" })).toBeFocused();
  expectSameCamera(await readSettledMapGeometry(page), beforeDetails);

  await collapse.press("Enter");
  await expect(directory).toHaveAttribute("data-directory-state", "collapsed");
  await expect(directory).toHaveCSS("width", "0px");
  await expect(directory.locator(".tanaw-spatial-directory-shell")).toHaveCSS("opacity", "0");
  const expand = page.getByRole("button", { name: "Expand spatial directory" });
  await expect(expand).toBeVisible();
  await expect(expand).toBeFocused();
  await expect(openInsights).toBeVisible();
  await expect(expand).not.toContainText("Spatial Directory");
  await expect(openInsights).not.toContainText("Visitor Insights");
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(openInsights).toHaveAttribute("aria-expanded", "false");
  await expect(expand).toHaveCSS("width", "44px");
  await expect(expand).toHaveCSS("height", "44px");
  const expandBox = await expand.boundingBox();
  const insightsBox = await openInsights.boundingBox();
  expect(expandBox).not.toBeNull();
  expect(insightsBox).not.toBeNull();
  expect(expandBox!.x).toBeCloseTo(collapseBox!.x, 0);
  expect(expandBox!.y).toBeCloseTo(collapseBox!.y, 0);
  expect(insightsBox!.x).toBeGreaterThan(1600);
  expect(insightsBox!.x).toBeCloseTo(initialInsightsBox!.x, 0);
  expect(insightsBox!.y).toBeCloseTo(initialInsightsBox!.y, 0);
  await expect(page.locator("#admin-enterprise-map .leaflet-tile-loaded").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("collapsed-map-tool-rail.png"), fullPage: true });

  await expand.click();
  await expect(directory).toHaveAttribute("data-directory-state", "expanded");
  await expect(collapse).toBeFocused();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(enterpriseCard).toHaveAttribute("aria-pressed", "true");
  await expect(directory).toHaveCSS("width", "384px");
  const restoredDirectoryBox = await directory.boundingBox();
  expect(restoredDirectoryBox!.width).toBeCloseTo(expandedDirectoryBox!.width, 0);
});

test("presents Visitor Insights as an accessible analytical workspace and highlights directory markers without changing map selection", async ({ page }, testInfo) => {
  await configureAdminMapSession(page);

  const marker = page.locator('#admin-enterprise-map .tanaw-map-pin[aria-label^="Map Camera Test Enterprise"]');
  const markerBody = marker.locator(".tanaw-enterprise-marker__body");
  const card = page.locator(".tanaw-map-enterprise-card").filter({ hasText: "Map Camera Test Enterprise" });
  await expect(marker.locator('.tanaw-enterprise-marker[data-tone="running"]')).toBeVisible();
  await expect(marker.locator(".tanaw-enterprise-marker__body svg")).toBeVisible();
  await expect(markerBody).toHaveCSS("width", "44px");
  await expect(card).toHaveAttribute("aria-pressed", "false");

  await card.hover();
  await expect(marker).toHaveClass(/is-directory-hovered/);
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("heading", { name: "Spatial Directory" }).hover();
  await expect(marker).not.toHaveClass(/is-directory-hovered/);
  await marker.hover();
  await expect(markerBody).toHaveCSS("transform", /^matrix\(1\.08,/);
  const tooltip = page.locator(".tanaw-enterprise-tooltip");
  await expect(tooltip).toContainText(mapEnterprise.fullAddress);
  await expect(tooltip).toContainText("Attraction · San Antonio");
  await expect(tooltip).toContainText("1/1 reporting");
  await expect(tooltip).toContainText("Live occupancy");
  await expect(tooltip).toContainText("12");
  const beforeMarkerClick = await readMapGeometry(page);
  await marker.click();
  const preview = page.getByRole("region", { name: "Enterprise preview" });
  await expect(preview).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(marker).toHaveClass(/is-selected/);
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readMapGeometry(page)).boundary.width).toBeGreaterThan(beforeMarkerClick.boundary.width);
  await expect(page.locator("#admin-enterprise-map .leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const focusedCamera = await readSettledMapGeometry(page);
  expect(Math.abs(focusedCamera.marker.centerX - (focusedCamera.directoryRight + focusedCamera.map.right) / 2)).toBeLessThan(40);
  await page.getByRole("button", { name: "Close enterprise preview" }).click();
  await expect(preview).toHaveCount(0);
  expectSameCamera(await readSettledMapGeometry(page), focusedCamera);

  const openInsights = page.getByRole("button", { name: "Open visitor insights" });
  await expect(openInsights).not.toContainText("Visitor Insights");
  await openInsights.click();
  const insights = page.getByRole("complementary", { name: "Visitor insights" });
  await expect(insights).toBeVisible();
  await expect(insights).toHaveCSS("backdrop-filter", "blur(9px) saturate(1.14)");
  await expect(insights.getByRole("heading", { name: "San Pedro" })).toBeVisible();
  await expect(insights.getByText("Visitors Right Now", { exact: true })).toBeVisible();
  await expect(insights.getByText("Learning", { exact: true })).toBeVisible();
  await expect(insights.getByText("Building a reliable comparison", { exact: true })).toBeVisible();
  await expect(insights.getByText("Activity Pattern", { exact: true })).toBeVisible();
  const chartBar = insights.locator(".recharts-bar-rectangle path").first();
  await expect(chartBar).toBeVisible();
  await expect(chartBar).toHaveCSS("fill", "rgb(13, 151, 106)");
  await expect(insights.getByText("Busiest Right Now", { exact: true })).toBeVisible();
  await expect(insights.getByText("Busiest Period", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("visitor-insights-light.png"), fullPage: true });
  const historyMetric = insights.getByLabel("History metric");
  await historyMetric.selectOption({ label: "Estimated Unique" });
  await expect(insights.getByText("Last daily estimate for each establishment")).toBeVisible();
  await expect(insights.locator(".recharts-bar-rectangle")).toHaveCount(2);

  const selectedRange = insights.getByRole("tab", { name: "7 days" });
  await expect(selectedRange).toHaveAttribute("aria-selected", "true");
  await selectedRange.focus();
  await page.keyboard.press("ArrowRight");
  await expect(insights.getByRole("tab", { name: "30 days" })).toHaveAttribute("aria-selected", "true");
  const closeInsights = page.getByRole("button", { name: "Close visitor insights" });
  const closeBox = (await closeInsights.boundingBox())!;
  await closeInsights.click();
  await expect(openInsights).toBeVisible();
  await expect(openInsights).toBeFocused();
  expect((await openInsights.boundingBox())!.x).toBeCloseTo(closeBox.x, 0);
  expectSameCamera(await readSettledMapGeometry(page), focusedCamera);
});

test("keeps a manually zoomed map through a staged theme switch, drag, and directory controls", async ({ page }) => {
  // Zooming, dragging and a staged theme switch that waits for map tiles take longer than the default.
  test.setTimeout(60_000);
  await configureAdminMapSession(page);
  const map = page.locator("#admin-enterprise-map");
  const labels = page.locator("#spatial-directory-panel").getByRole("button", { name: "Show Map Labels" });
  await expect(labels).toHaveText("Labels");
  const initial = await readSettledMapGeometry(page);
  const mapBox = (await map.boundingBox())!;
  await page.mouse.move(mapBox.x + mapBox.width * 0.6, mapBox.y + mapBox.height * 0.45);
  await page.mouse.wheel(0, -90);
  await expect.poll(async () => (await readMapGeometry(page)).boundary.width).toBeGreaterThan(initial.boundary.width + 50);
  await page.waitForTimeout(275);
  const zoomed = await readMapGeometry(page);

  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width * 0.6 + 85, mapBox.y + mapBox.height * 0.45 - 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await readMapGeometry(page)).marker.centerX - zoomed.marker.centerX)).toBeGreaterThan(40);
  await page.waitForTimeout(400);
  const dragged = await readSettledMapGeometry(page);
  expect(dragged.boundary.width).toBeCloseTo(zoomed.boundary.width, -1);

  await page.getByRole("button", { name: "Collapse spatial directory" }).click();
  await page.getByRole("button", { name: "Expand spatial directory" }).click();
  await labels.click();
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveAttribute("data-map-labels", "hidden");
  await expect(page.locator(".tanaw-label-tiles--light")).toHaveCSS("visibility", "hidden");
  expectSameCamera(await readSettledMapGeometry(page), dragged);

  let releaseTiles: () => void = () => undefined;
  const blockedTiles = new Promise<void>((resolve) => {
    releaseTiles = resolve;
  });
  await page.route("**/dark_nolabels/**", async (route) => {
    await blockedTiles;
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  try {
    const toggle = page.getByRole("button", { name: "Switch to dark mode" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-busy", "true");
    await expect(map.locator(".tanaw-base-tiles--dark")).toHaveCSS("opacity", "0");
    await expect(map.locator(".tanaw-base-tiles--light")).toHaveCSS("opacity", "1");
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
  } finally {
    releaseTiles();
  }
  await expect(map).toHaveAttribute("data-map-tiles", "dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.locator("[data-topbar-theme]")).toHaveAttribute("data-topbar-theme", "dark");
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  expectSameCamera(await readSettledMapGeometry(page), dragged);

  await page.getByRole("link", { name: "Operations Center" }).click();
  await expect(page.getByRole("heading", { name: "Operations Center" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Live Map" })).toHaveCount(0);
  await page.getByRole("link", { name: "Map View" }).click();
  await waitForMapReady(page);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.reload();
  await waitForMapReady(page);
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveAttribute("data-map-tiles", "dark");
  await labels.click();
  await expect(map.locator(".tanaw-label-tiles--dark")).toHaveCSS("visibility", "visible");

  let releaseLightTiles: () => void = () => undefined;
  const slowTiles = new Promise<void>((resolve) => {
    releaseLightTiles = resolve;
  });
  await page.route("**/rastertiles/voyager_nolabels/**", async (route) => {
    await slowTiles;
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  try {
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).toHaveClass(/\blight\b/);
    await expect(map).toHaveAttribute("data-map-tiles", "dark");
    await expect(map.locator(".tanaw-base-tiles--dark")).toHaveCSS("opacity", "1");
    await expect(map.locator(".tanaw-base-tiles--light")).toHaveCSS("opacity", "0");
  } finally {
    releaseLightTiles();
  }
  await expect(map).toHaveAttribute("data-map-tiles", "light");
  await expect(labels).toHaveAttribute("aria-pressed", "true");
});

test("keeps map controls accessible on mobile and searches the Spatial Directory", async ({ page }, testInfo) => {
  await configureAdminMapSession(page, { viewport: { width: 390, height: 844 } });
  const labels = page.getByRole("button", { name: "Show Map Labels" });
  await expect(labels).toHaveCount(0);
  await page.getByRole("button", { name: "Expand spatial directory" }).click();
  await expect(labels).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search enterprises" });
  await search.fill("a name not in the registry");
  await expect(page.getByText("No enterprises match your search.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".tanaw-map-enterprise-card").filter({ hasText: mapEnterprise.name })).toBeVisible();
  await labels.click();
  await expect(page.locator("#admin-enterprise-map")).toHaveAttribute("data-map-labels", "hidden");
  await page.getByRole("combobox", { name: "Select barangay" }).click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await expect(page.locator("#spatial-directory-panel")).toHaveAttribute("data-directory-state", "collapsed");
  await expect(labels).toHaveCount(0);
  await expect(page.locator("#admin-enterprise-map .leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const boundary = await page.locator('#admin-enterprise-map .tanaw-boundary-path[stroke="#167052"]').boundingBox();
  expect(boundary!.x).toBeGreaterThan(24);
  expect(boundary!.x + boundary!.width).toBeLessThan(390 - 24);

  const insightsLauncher = page.getByRole("button", { name: "Open visitor insights" });
  await insightsLauncher.click();
  const insights = page.getByRole("complementary", { name: "Visitor insights" });
  await expect(insights).toBeVisible();
  await expect(insights.getByLabel("History metric")).toBeVisible();
  await expect(insights.locator(".recharts-bar-rectangle path").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand spatial directory" })).toBeVisible();
  await expect.poll(async () => (await insights.boundingBox())!.x).toBeCloseTo(16, 0);
  const mobileDrawer = (await insights.boundingBox())!;
  expect(mobileDrawer.x + mobileDrawer.width).toBeCloseTo(390 - 16, 0);
  await page.screenshot({ path: testInfo.outputPath("visitor-insights-mobile.png") });
  await page.getByRole("button", { name: "Close visitor insights" }).click();
  await expect(page.getByRole("button", { name: "Expand spatial directory" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 520 });
  await page.getByRole("button", { name: "Expand spatial directory" }).click();
  const compactDirectory = page.locator("#spatial-directory-panel .tanaw-map-directory");
  const title = compactDirectory.getByRole("heading", { name: "Spatial Directory" });
  const titleTop = (await title.boundingBox())!.y;
  expect(await compactDirectory.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  })).toBeGreaterThan(0);
  await expect.poll(async () => (await title.boundingBox())!.y).toBeCloseTo(titleTop, 0);
  await expect(page.getByRole("button", { name: "Collapse spatial directory" })).toBeVisible();
  const accountButton = (await page.getByRole("button", { name: "Open account menu" }).boundingBox())!;
  expect(accountButton.x + accountButton.width).toBeLessThanOrEqual(320);
});

test("keeps the modernized Admin data workspaces semantic and keyboard operable", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
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
  for (const [filterName, initial, next] of [
    ["Filter activity category", "All Activity", "Reports"],
    ["Filter activity time range", "All Time", "Today"],
  ]) {
    const filter = page.getByRole("combobox", { name: filterName });
    await expect(filter).toHaveCSS("background-color", "rgb(25, 38, 51)");
    await filter.hover();
    await expect(filter).toHaveCSS("background-color", "rgb(32, 46, 60)");
    await filter.press("Enter");
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    await expect(filter).toHaveCSS("border-top-color", "rgb(94, 234, 212)");
    const menu = page.getByRole("listbox", { name: filterName });
    await expect(menu.locator("..")).toHaveCSS("background-color", "rgb(25, 37, 49)");
    await expect(menu.getByRole("option", { name: initial, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("option", { name: next, exact: true })).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
    await expect(filter).toContainText(next);
    await expect(filter).toBeFocused();
    await expect(filter).toHaveCSS("border-top-color", "rgb(94, 234, 212)");
  }
  await page.screenshot({ path: testInfo.outputPath("activity-history-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  for (const [filterName, next] of [
    ["Filter activity category", "Reports"],
    ["Filter activity time range", "Today"],
  ]) {
    const filter = page.getByRole("combobox", { name: filterName });
    await expect(filter).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await filter.click();
    await expect(filter).toHaveCSS("border-top-color", "rgb(15, 118, 110)");
    const menu = page.getByRole("listbox", { name: filterName });
    await expect(menu.locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(menu.getByRole("option", { name: next, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(filter).toHaveAttribute("aria-expanded", "false");
  }
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

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
