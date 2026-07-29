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
  expect(Math.abs(geometry.boundary.centerX - usableCenterX)).toBeLessThan(Math.max(80, geometry.map.width * 0.08));
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

  await page.getByRole("link", { name: "Activity History" }).click();
  await expect(page).toHaveURL(/\/admin\/activity-history$/);
  await page.getByRole("link", { name: "Map View" }).click();
  await expect(page).toHaveURL(/\/admin\/mapview$/);
  await waitForMapReady(page);
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
  await page.getByRole("button", { name: "Back to Barangay Directory" }).click();
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
  await expect(page.getByText("No Barangay Selected")).toBeVisible();
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
