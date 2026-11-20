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

async function configureAdminMapSession(page: Page, options: { theme?: "dark" | "light"; followSystem?: boolean; viewport?: { height: number; width: number }; enterprises?: MapEnterprise[] } = {}) {
  let signedIn = false;
  const colorScheme = options.theme ?? "light";
  if (options.followSystem) await page.emulateMedia({ colorScheme });
  const theme = options.followSystem ? "system" : colorScheme;

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
  const usableCenterX = (geometry.map.left + geometry.map.right) / 2;
  const minimumBoundaryWidthRatio = geometry.map.width >= 1600 ? 0.35 : 0.25;

  expect(geometry.boundary.width).toBeGreaterThan(geometry.map.width * minimumBoundaryWidthRatio);
  expect(geometry.boundary.left).toBeGreaterThan(geometry.map.left + 24);
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
      const boundary = renderer.querySelector(".tanaw-boundary-path")!;
      const casing = Array.from(renderer.querySelectorAll(".tanaw-boundary-casing")).find((path) => path.getAttribute("d") === boundary.getAttribute("d"))!;
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
      type Frame = { scaleDifference: number; pinError: number; incomingLevel: boolean; casingAligned: boolean };
      return new Promise<Frame[]>((resolve) => {
        const samples: Frame[] = [];
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
              casingAligned: casing.getAttribute("d") === boundary.getAttribute("d"),
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
    expect(samples.every((sample) => sample.casingAligned)).toBe(true);
  }
});

test("switches between enterprise previews, reports missing telemetry, and preserves the camera with the directory visible", async ({ page }, testInfo) => {
  // Several previews, panel toggles and settled camera readings take longer than the default.
  test.setTimeout(60_000);
  const offlineEnterprise: MapEnterprise = {
    ...mapEnterprise, id: "offline-enterprise", name: "Offline Enterprise", lng: mapEnterprise.lng + 0.006,
    monitoringStatus: "Offline", occupancyStatus: "No Data", totalLiveOccupancy: null, cameraMonitoring: null,
  };
  await configureAdminMapSession(page, { followSystem: true, theme: "dark", enterprises: [mapEnterprise, offlineEnterprise] });
  const card = page.locator(".tanaw-map-enterprise-card").filter({ hasText: mapEnterprise.name });
  const other = page.locator(".tanaw-map-enterprise-card").filter({ hasText: offlineEnterprise.name });
  const marker = page.locator(".tanaw-map-pin").filter({ has: page.locator(".tanaw-enterprise-marker[data-tone='inactive']") });
  const preview = page.getByRole("region", { name: "Enterprise preview" });
  await card.click();
  await expect(preview).toContainText(mapEnterprise.name);
  const firstCamera = await readSettledMapGeometry(page);
  await card.click();
  expectSameCamera(await readSettledMapGeometry(page), firstCamera);
  await other.click();
  await expect(preview).toContainText(offlineEnterprise.name);
  await expect(preview).toContainText("Offline");
  await expect(preview.getByText("No telemetry", { exact: true })).toBeVisible();
  await expect(preview.getByText("No live data", { exact: true })).toBeVisible();
  await expect(other.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  await expect(marker).toHaveClass(/is-selected/);
  await expect(page.locator(".tanaw-enterprise-popup .leaflet-popup-content-wrapper")).toHaveCSS("background-color", "rgb(25, 41, 37)");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const selectedCamera = await readSettledMapGeometry(page);
  await expect(page.getByRole("complementary", { name: "Spatial Directory" })).toBeVisible();
  await expect(page.locator("#visitor-insights-launcher, #spatial-directory-toggle")).toHaveCount(0);
  expectSameCamera(await readSettledMapGeometry(page), selectedCamera);
  await page.screenshot({ path: testInfo.outputPath("enterprise-preview-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
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
  await expect(map.locator(".leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
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

test("fits the city on entry and on both All Barangays actions", async ({ page }) => {
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
  const operationsLink = page.getByRole("link", { name: "Alerts & Requests" });
  const mapViewLink = page.getByRole("link", { name: "Map View" });
  const underline = page.locator("[data-topbar-underline]:visible");
  await expect(mapViewLink).toHaveAttribute("aria-current", "page");
  await expect(underline).toHaveCSS("height", "2px");
  await expect(underline).toHaveCSS("box-shadow", /8px/);
  const selectedBox = await underline.boundingBox();
  await operationsLink.hover();
  expect(await underline.boundingBox()).toEqual(selectedBox);
  await mapViewLink.focus();
  await page.keyboard.press("Tab");
  await expect(activityHistoryLink).toBeFocused();
  await expect(activityHistoryLink).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(operationsLink).toBeFocused();
  await expect(mapViewLink).toHaveAttribute("aria-current", "page");
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

  await page.getByRole("link", { name: "Alerts & Requests" }).click();
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
  const backToDirectory = page.getByRole("button", { name: "All Barangays", exact: true });
  await expect(backToDirectory).toContainText("All Barangays");
  await expect(page.getByRole("heading", { name: "Barangay San Antonio" })).toBeVisible();
  const filteredCamera = await readSettledMapGeometry(page);
  await backToDirectory.click();
  await expect(barangaySelect).toContainText("All Barangays");
  await page.waitForTimeout(900);
  const backCamera = await readSettledMapGeometry(page);
  expect(backCamera.boundary.width).toBeLessThan(filteredCamera.boundary.width);
  expectSameCamera(backCamera, initial);

  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await page.waitForTimeout(900);
  const dropdownCamera = await readSettledMapGeometry(page);
  await barangaySelect.click();
  await page.getByRole("option", { name: /All Barangays/ }).click();
  await expect(barangaySelect).toContainText("All Barangays");
  await page.waitForTimeout(900);
  const dropdownReset = await readSettledMapGeometry(page);
  expect(dropdownReset.boundary.width).toBeLessThan(dropdownCamera.boundary.width);
  expectSameCamera(dropdownReset, backCamera);

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

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(map.locator("path.tanaw-boundary-path")).toHaveCount(28);
  expectCanonicalCitywideFraming(await readSettledMapGeometry(page));
  await page.setViewportSize({ width: 1280, height: 800 });
  const accountButton = (await page.getByRole("button", { name: "Open account menu" }).boundingBox())!;
  const insightsLink = (await page.getByRole("link", { name: "Visitor Insights" }).boundingBox())!;
  expect(insightsLink.x + insightsLink.width).toBeLessThan(accountButton.x);
  expect(accountButton.x + accountButton.width).toBeLessThanOrEqual(1280);
  await expect(page.getByRole("link", { name: "Alerts & Requests" })).toHaveCSS("white-space", "nowrap");
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
  await expect(map.locator(".tanaw-base-tiles--dark")).toHaveCSS("filter", /sepia\(0\.46\)/);
  const outlines = map.locator('.tanaw-boundary-path[data-boundary-state="default"][stroke="#b1d9cc"]');
  const casings = map.locator('.tanaw-boundary-casing[stroke="#071512"]');
  await expect(outlines).toHaveCount(28);
  await expect(casings).toHaveCount(28);
  await expect(casings.first()).toHaveCSS("pointer-events", "none");
  await expect(outlines.first()).toHaveCSS("vector-effect", "non-scaling-stroke");
  await page.screenshot({ path: testInfo.outputPath("admin-map-dark.png") });

  await page.getByRole("combobox", { name: "Select barangay" }).click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  const selectedBoundary = map.locator('.tanaw-boundary-path[data-boundary-state="selected"]');
  await expect(selectedBoundary).toHaveAttribute("stroke-width", "3.25");
  await expect(selectedBoundary).toHaveAttribute("stroke", "#a0f5cb");
  await expect(map.locator('.tanaw-boundary-path[data-boundary-state="muted"][fill="#071613"][stroke="#a2ccbf"]')).toHaveCount(27);
  await expect(page.locator("#spatial-directory-panel")).toHaveCSS("overflow", "hidden");
  await expect.poll(async () => (await readMapGeometry(page)).boundary.width).toBeGreaterThan(initial.boundary.width);
  await expect(map.locator(".leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const bounds = (await selectedBoundary.boundingBox())!;
  expect(bounds.x).toBeGreaterThan(initial.directoryRight + 30);
  expect(bounds.x + bounds.width).toBeLessThan(initial.map.right - 30);
  expect(bounds.y).toBeGreaterThan(initial.map.top + 30);
  expect(bounds.y + bounds.height).toBeLessThan(initial.map.bottom - 30);

  const boundariesToggle = page.getByRole("button", { name: "Boundaries", exact: true });
  await boundariesToggle.click();
  await expect(map.locator(".tanaw-boundary-path, .tanaw-boundary-casing")).toHaveCount(0);
  await boundariesToggle.click();
  await expect(casings).toHaveCount(28);
  await expect(selectedBoundary).toHaveCount(1);
});

test("scrolls enterprise results independently and selects a matching marker by keyboard", async ({ page }) => {
  const enterprises = Array.from({ length: 16 }, (_, index) => ({
    ...mapEnterprise,
    id: `scroll-enterprise-${index}`,
    name: `Directory Enterprise ${String(index + 1).padStart(2, "0")}`,
    lng: mapEnterprise.lng + index * 0.0006,
  }));
  await configureAdminMapSession(page, { enterprises, viewport: { width: 1280, height: 800 } });
  const results = page.getByRole("region", { name: "Enterprise results" });
  const initialCamera = await readSettledMapGeometry(page);
  const scrollPosition = () => results.evaluate((element) => element.scrollTop);
  await results.hover();
  await page.mouse.wheel(0, 260);
  await expect.poll(scrollPosition).toBeGreaterThan(0);
  await results.focus();
  await page.keyboard.press("End");
  await expect.poll(() => results.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await expect(page.getByRole("heading", { name: "Spatial Directory" })).toBeInViewport();
  await expect(page.getByRole("searchbox", { name: "Search enterprises" })).toBeInViewport();
  expectSameCamera(await readSettledMapGeometry(page), initialCamera);

  const name = enterprises[enterprises.length - 1]!.name;
  const row = results.getByRole("button", { name, exact: true });
  await row.focus();
  await expect(results.locator(".tanaw-map-enterprise-card").filter({ has: page.getByRole("button", { name, exact: true }) })).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Enterprise preview" })).toContainText(name);
  await expect(page.locator("#admin-enterprise-map .tanaw-map-pin.is-selected")).toHaveAttribute("aria-label", new RegExp(name));
});

test("keeps the wider Spatial Directory and map side by side and preserves Enterprise Details", async ({ page }, testInfo) => {
  await configureAdminMapSession(page);

  const directory = page.locator("#spatial-directory-panel");
  await expect(directory).toBeVisible();
  const directoryBox = (await directory.boundingBox())!;
  const mapBox = (await page.locator("#admin-enterprise-map").boundingBox())!;
  expect(directoryBox.x + directoryBox.width).toBeLessThan(mapBox.x);
  expect(directoryBox.width / (mapBox.width + directoryBox.width)).toBeCloseTo(0.36, 1);
  expect(directoryBox.width).toBeGreaterThan(384);
  expect(directoryBox.width).toBeLessThan(mapBox.width);
  await page.screenshot({ path: testInfo.outputPath("spatial-directory-light.png") });
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

  await expect(directory).toBeVisible();
  await expect(page.locator("#spatial-directory-toggle")).toHaveCount(0);
  await preview.getByRole("button", { name: "View Details" }).click();
  const [enterpriseRequest] = await Promise.all([
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/visitor-insights") && url.searchParams.get("enterpriseId") === mapEnterprise.id;
    }),
    detailsDialog.getByRole("button", { name: "View visitor insights" }).click(),
  ]);
  expect(new URL(enterpriseRequest.url()).searchParams.has("barangay")).toBe(false);
  await expect(page.getByRole("heading", { name: "Visitor Insights" })).toBeVisible();
  await Promise.all([
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/visitor-insights") && url.searchParams.get("barangay") === mapEnterprise.barangay;
    }),
    page.getByRole("button", { name: "View the surrounding area instead" }).click(),
  ]);
});

test("presents Visitor Insights as an accessible analytical workspace and highlights directory markers without changing map selection", async ({ page }, testInfo) => {
  await configureAdminMapSession(page);

  const marker = page.locator('#admin-enterprise-map .tanaw-map-pin[aria-label^="Map Camera Test Enterprise"]');
  const markerBody = marker.locator(".tanaw-enterprise-marker__body");
  const card = page.locator(".tanaw-map-enterprise-card").filter({ hasText: "Map Camera Test Enterprise" });
  await expect(marker.locator('.tanaw-enterprise-marker[data-tone="running"]')).toBeVisible();
  await expect(marker.locator(".tanaw-enterprise-marker__body svg")).toBeVisible();
  await expect(markerBody).toHaveCSS("width", "44px");
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "false");

  await card.hover();
  await expect(marker).toHaveClass(/is-directory-hovered/);
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "false");
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
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readMapGeometry(page)).boundary.width).toBeGreaterThan(beforeMarkerClick.boundary.width);
  await expect(page.locator("#admin-enterprise-map .leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const focusedCamera = await readSettledMapGeometry(page);
  expect(Math.abs(focusedCamera.marker.centerX - (focusedCamera.map.left + focusedCamera.map.right) / 2)).toBeLessThan(40);
  await page.getByRole("button", { name: "Close enterprise preview" }).click();
  await expect(preview).toHaveCount(0);
  expectSameCamera(await readSettledMapGeometry(page), focusedCamera);

  const insightsLink = page.getByRole("link", { name: "Visitor Insights" });
  await insightsLink.click();
  await expect(page).toHaveURL(/\/admin\/visitor-insights$/);
  await expect(insightsLink).toHaveAttribute("aria-current", "page");
  const insights = page.locator(".tanaw-visitor-insights");
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
  const historyMetric = insights.getByRole("radiogroup", { name: "History metric" });
  const occupancy = historyMetric.getByRole("radio", { name: "Occupancy", exact: true });
  const unique = historyMetric.getByRole("radio", { name: "Estimated Unique" });
  await expect(occupancy).toBeChecked();
  await occupancy.press("ArrowRight");
  await expect(unique).toBeChecked();
  await expect(unique).toBeFocused();
  await expect(insights.getByText("Last daily estimate for each establishment")).toBeVisible();
  await expect(insights.locator(".recharts-bar-rectangle")).toHaveCount(2);

  const selectedRange = insights.getByRole("tab", { name: "7 Days" });
  await expect(selectedRange).toHaveAttribute("aria-selected", "true");
  await selectedRange.focus();
  await page.keyboard.press("ArrowRight");
  await expect(insights.getByRole("tab", { name: "30 Days" })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page.getByRole("link", { name: "Map View" })).toHaveAttribute("aria-current", "page");
  await waitForMapReady(page);
  await page.goForward();
  await expect(insightsLink).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(insightsLink).toHaveAttribute("aria-current", "page");
  await expect(insights.getByRole("heading", { name: "San Pedro" })).toBeVisible();
});

test("keeps a manually zoomed map through a staged theme switch, drag, and directory controls", async ({ page }) => {
  // Zooming, dragging and a staged theme switch that waits for map tiles take longer than the default.
  test.setTimeout(60_000);
  const secondEnterprise = { ...mapEnterprise, id: "second-map-enterprise", name: "Second Map Enterprise", lng: mapEnterprise.lng + 0.006 };
  await configureAdminMapSession(page, { followSystem: true, enterprises: [mapEnterprise, secondEnterprise] });
  const map = page.locator("#admin-enterprise-map");
  const labels = page.locator("#spatial-directory-panel").getByRole("button", { name: "Show Map Labels" });
  await expect(labels).toHaveText("Labels");
  // Panning can clip boundary paths at the edge of the SVG renderer. Marker spacing tracks scale across pans.
  const markerSpacing = (geometry: MapGeometry) => {
    const [first, second] = Object.values(geometry.markers);
    return Math.hypot(first.centerX - second.centerX, first.centerY - second.centerY);
  };
  const initial = await readSettledMapGeometry(page);
  const mapBox = (await map.boundingBox())!;
  await page.mouse.move(mapBox.x + mapBox.width * 0.6, mapBox.y + mapBox.height * 0.45);
  await page.mouse.wheel(0, -90);
  await expect.poll(async () => markerSpacing(await readMapGeometry(page))).toBeGreaterThan(markerSpacing(initial));
  const zoomed = await readSettledMapGeometry(page);

  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width * 0.6 + 85, mapBox.y + mapBox.height * 0.45 - 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await readMapGeometry(page)).marker.centerX - zoomed.marker.centerX)).toBeGreaterThan(40);
  await page.waitForTimeout(400);
  const dragged = await readSettledMapGeometry(page);
  expect(markerSpacing(dragged)).toBeCloseTo(markerSpacing(zoomed), 0);

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
    const tileRequest = page.waitForRequest("**/dark_nolabels/**");
    await page.emulateMedia({ colorScheme: "dark" });
    await tileRequest;
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(map).toHaveAttribute("data-map-tiles", "light");
    await expect(map.locator(".tanaw-base-tiles--dark")).toHaveCSS("opacity", "0");
    await expect(map.locator(".tanaw-base-tiles--light")).toHaveCSS("opacity", "1");
  } finally {
    releaseTiles();
  }
  await expect(map).toHaveAttribute("data-map-tiles", "dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.locator("[data-topbar-theme]")).toHaveAttribute("data-topbar-theme", "dark");
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  expectSameCamera(await readSettledMapGeometry(page), dragged);

  await page.getByRole("link", { name: "Alerts & Requests" }).click();
  await expect(page.getByRole("heading", { name: "Alerts & Requests" })).toBeVisible();
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
    await page.emulateMedia({ colorScheme: "light" });
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
  await expect(page.locator("#spatial-directory-panel")).toBeVisible();
  await expect(page.locator("#admin-enterprise-map .leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const boundary = await page.locator('#admin-enterprise-map .tanaw-boundary-path[stroke="#167052"]').boundingBox();
  expect(boundary!.x).toBeGreaterThan(24);
  expect(boundary!.x + boundary!.width).toBeLessThan(390 - 24);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Visitor Insights" }).click();
  const insights = page.locator(".tanaw-visitor-insights");
  await expect(insights.getByRole("radiogroup", { name: "History metric" })).toBeVisible();
  await expect(insights.locator(".recharts-bar-rectangle path").first()).toBeVisible();
  const dashboard = (await insights.boundingBox())!;
  expect(dashboard.x + dashboard.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("visitor-insights-mobile.png") });
});

test("keeps the modernized Admin data workspaces semantic and keyboard operable", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await configureAdminMapSession(page);

  let resolutionStatus = "Unresolved";
  await page.route("**/activity-logs**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "activity-modernization-1",
          timestamp: new Date().toISOString(),
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
        {
          id: "activity-modernization-3",
          timestamp: "2026-08-08T11:20:00+08:00",
          category: "Enterprise Activity",
          severity: "Warning",
          actor: "San Pedro Convention Hall",
          actorRole: "Enterprise Account",
          action: "Desktop Application Problem",
          target: "San Pedro Convention Hall",
          summary: "Camera stopped reporting.",
          resolutionStatus,
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
  const activityRows = auditWorkspace.locator("tbody tr");
  await expect(activityRows.first()).toContainText("Unresolved");
  await expect(activityRows.first()).toContainText("Desktop Application Problem");
  const summary = page.getByRole("region", { name: "Activity history summary" });
  const category = page.getByRole("combobox", { name: "Filter activity category" });
  const today = summary.getByRole("button", { name: /^Today/ });
  await today.click();
  await expect(today).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Filter activity time range" })).toContainText("Today");
  await expect(activityRows).toHaveCount(1);
  await expect(activityRows.first()).toContainText("Login");
  await today.click();

  for (const [label, option, action] of [
    ["Report Updates", "Reports", "Submit Enterprise Report"],
    ["Admin Activity", "Admin Activity", "Login"],
    ["Important Updates", "Important Updates", "Desktop Application Problem"],
  ]) {
    const shortcut = summary.getByRole("button", { name: new RegExp(`^${label}`) });
    await shortcut.press("Enter");
    await expect(shortcut).toHaveAttribute("aria-pressed", "true");
    await expect(category).toContainText(option);
    await expect(activityRows).toHaveCount(1);
    await expect(activityRows.first()).toContainText(action);
  }
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(category).toContainText("All Activity");
  await expect(activityRows).toHaveCount(3);

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

  resolutionStatus = "Resolved";
  await page.reload();
  await expect(activityRows.first()).toContainText("Login");
  await expect(activityRows.last()).toContainText("Desktop Application Problem");
  await expect(activityRows.last().getByText("Resolved", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Alerts & Requests" }).click();
  const operationsWorkspace = page.locator(".tanaw-operations-workspace");
  await expect(operationsWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Alerts & Requests summary" })).toBeVisible();
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
  await configureAdminMapSession(page, { followSystem: true, theme: "dark", viewport: { width: 1366, height: 768 } });
  await page.getByRole("link", { name: "Visitor Insights" }).click();
  await expect(page.getByRole("heading", { name: "Visitor Insights" })).toBeVisible();
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
  await page.emulateMedia({ colorScheme: "light" });
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
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.getByRole("link", { name: "Alerts & Requests" }).click();
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

test("refits a clicked barangay and applies wheel input received during the camera transition", async ({ page }) => {
  await configureAdminMapSession(page, { viewport: { width: 1440, height: 900 } });
  const barangay = page.getByRole("combobox", { name: "Select barangay" });
  await barangay.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  const selected = page.locator('.tanaw-boundary-path[data-boundary-state="selected"]');
  await expect(selected).toBeVisible();
  const fitted = await readSettledMapGeometry(page);
  const fittedWidth = (await selected.boundingBox())!.width;

  await page.locator(".leaflet-control-zoom-out").click();
  await expect.poll(async () => (await readMapGeometry(page)).boundary.width).toBeLessThan(fitted.boundary.width - 40);
  await readSettledMapGeometry(page);
  const point = await selected.evaluate((path: SVGPathElement) => {
    const bounds = path.getBoundingClientRect();
    for (let x = bounds.left; x < bounds.right; x += 14) {
      for (let y = bounds.top; y < bounds.bottom; y += 14) {
        if (document.elementFromPoint(x, y) === path) return { x, y };
      }
    }
    throw new Error("Selected barangay has no visible interactive area");
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#admin-enterprise-map .leaflet-map-pane")).toHaveClass(/leaflet-zoom-anim/);
  await page.mouse.move((fitted.map.left + fitted.map.right) / 2, (fitted.map.top + fitted.map.bottom) / 2);
  await page.mouse.wheel(0, -30);
  await page.mouse.wheel(0, -30);
  await expect(barangay).toContainText("Barangay San Antonio");
  await expect(selected).toHaveCount(1);
  await expect.poll(async () => (await selected.boundingBox())?.width ?? 0).toBeGreaterThan(fittedWidth * 1.1);
});

test("returns to All Barangays after ten idle seconds and waits while the user is exploring", async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  await configureAdminMapSession(page, { viewport: { width: 1440, height: 900 } });
  const initial = await readSettledMapGeometry(page);
  // Control the idle interval independently of time spent waiting for browser actions.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const map = page.locator("#admin-enterprise-map");
  const selectedBoundary = map.locator('.tanaw-boundary-path[stroke="#167052"]');
  const barangay = page.getByRole("combobox", { name: "Select barangay" });
  await barangay.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await page.clock.runFor(500);
  await expect(selectedBoundary).toBeVisible();
  const selected = await readSettledMapGeometry(page);
  expect(selected.boundary.width).toBeGreaterThan(initial.boundary.width);

  await page.clock.fastForward(6000);
  await page.getByRole("searchbox", { name: "Search enterprises" }).fill("example");
  await page.clock.fastForward(5000);
  await expect(barangay).toContainText("Barangay San Antonio");
  await page.mouse.move(selected.map.left + 100, selected.map.top + 100);
  await page.mouse.down();
  await page.mouse.move(selected.map.left + 130, selected.map.top + 120);
  await page.clock.fastForward(11000);
  await expect(barangay).toContainText("Barangay San Antonio");
  await page.mouse.up();
  await page.clock.fastForward(9000);
  await expect(barangay).toContainText("Barangay San Antonio");
  await map.locator(".leaflet-control-zoom-out").click();
  await page.clock.fastForward(9000);
  await expect(barangay).toContainText("Barangay San Antonio");
  await page.clock.fastForward(1050);
  await page.clock.runFor(500);

  await expect(barangay).toContainText("All Barangays");
  await expect(selectedBoundary).toHaveCount(0);
  await expect(map.locator("path.tanaw-boundary-path")).toHaveCount(28);
  expectSameCamera(await readSettledMapGeometry(page), initial);

  await map.locator(".leaflet-control-zoom-in").click();
  await page.clock.runFor(500);
  const manualCamera = await readSettledMapGeometry(page);
  expect(manualCamera.boundary.width).toBeGreaterThan(initial.boundary.width);
  await page.clock.fastForward(11000);
  expectSameCamera(await readSettledMapGeometry(page), manualCamera);
});
