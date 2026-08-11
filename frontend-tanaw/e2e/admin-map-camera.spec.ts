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
  await expect(glassIndicator).toHaveCount(0);
  await expect(page.locator("[data-topbar-active-surface], [data-topbar-liquid-layer], [data-topbar-liquid-bridge]")).toHaveCount(0);
  await mapViewLink.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "mapview");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-origin", "droplet-center");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-motion", "edge-glide");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-geometry", "independent-endcaps");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-shape", "capsule-droplet");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge", "adaptive-neutral-refraction");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-thickness", "hairline");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-distortion", "subtle");
  const refractiveEdge = glassIndicator.locator("[data-topbar-glass-refraction='background-adaptive']");
  await expect(refractiveEdge).toHaveCount(1);
  await expect(refractiveEdge).toHaveCSS("filter", /tanaw-topbar-edge-distortion/);
  await expect(glassIndicator).toHaveCSS("border-top-width", "0px");
  await expect(refractiveEdge).toHaveCSS("padding-top", "0.75px");
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
  await expect(glassIndicator).toHaveCSS("border-radius", "999px");
  await page.mouse.move((mapViewBox!.x + mapViewBox!.width + activityHistoryBox!.x) / 2, activityHistoryBox!.y + activityHistoryBox!.height / 2);
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "gap");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "gap:mapview:activity-history");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-deformation", "1.000");
  await expect(glassIndicator).toHaveCSS("border-radius", "999px");
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
  await expect(glassIndicator).toHaveCount(0);
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

test("keeps the Spatial Directory readable, compact when retracted, and map-safe while balancing Enterprise Details", async ({ page }) => {
  await configureAdminMapSession(page);

  const directory = page.locator("#spatial-directory-panel");
  const collapse = page.getByRole("button", { name: "Collapse spatial directory" });
  await expect(directory).toHaveAttribute("data-directory-state", "expanded");
  const expandedDirectoryBox = await directory.boundingBox();
  const collapseBox = await collapse.boundingBox();
  expect(expandedDirectoryBox).not.toBeNull();
  expect(collapseBox).not.toBeNull();
  expect(collapseBox!.y + collapseBox!.height / 2).toBeCloseTo(expandedDirectoryBox!.y + expandedDirectoryBox!.height / 2, 0);

  await page.getByRole("button", { name: /Map Camera Test Enterprise/ }).click();
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
  await expect(expand).toContainText("Spatial Directory");
  const collapsedDirectoryBox = await directory.boundingBox();
  const expandBox = await expand.boundingBox();
  expect(collapsedDirectoryBox).not.toBeNull();
  expect(expandBox).not.toBeNull();
  expect(expandBox!.y + expandBox!.height / 2).toBeCloseTo(collapsedDirectoryBox!.y + collapsedDirectoryBox!.height / 2, 0);
  await expect(page.locator("#admin-enterprise-map .leaflet-tile-loaded").first()).toBeVisible();

  await expand.click();
  await expect(directory).toHaveAttribute("data-directory-state", "expanded");
  await expect(page.getByRole("heading", { name: "Barangay San Antonio" })).toBeVisible();
  await expect(directory).toHaveCSS("width", "408px");
  const restoredDirectoryBox = await directory.boundingBox();
  expect(restoredDirectoryBox!.width).toBeCloseTo(expandedDirectoryBox!.width, 0);
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
