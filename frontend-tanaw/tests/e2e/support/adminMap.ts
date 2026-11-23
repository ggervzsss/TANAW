import { Buffer } from "node:buffer";
import { expect, type Page } from "@playwright/test";
import type { MapEnterprise, VisitorInsights } from "../../../src/shared/types";
import { json, mockPortalSession, portalUser } from "./session";

// Shared setup for the Admin Dashboard specs (admin-dashboard and admin-map-camera): an admin
// signs in through the real form and lands on the dashboard with its map ready.

export const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==", "base64");

export const adminUser = portalUser("admin", {
  id: "admin-map-camera-test",
  email: "admin-map-camera@example.test",
  title: "Administrator Account",
  firstName: "LGU",
  lastName: "Admin",
});

export const mapEnterprise: MapEnterprise = {
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

/** A visitor-insights answer for `range`, with no busy enterprises unless given. */
export function visitorInsights(range: VisitorInsights["range"], overrides: Partial<VisitorInsights> = {}): VisitorInsights {
  return {
    range,
    scopeType: "city",
    scopeId: null,
    scopeName: "San Pedro",
    currentVisitors: 12,
    typicalVisitors: null,
    differencePercent: null,
    comparisonMessage: "More matching days are needed before TANAW can make a reliable comparison.",
    busiestEnterprise: null,
    busiestPeriodLabel: null,
    series: [],
    unusuallyBusy: [],
    lastUpdatedAt: null,
    ...overrides,
  };
}

export type MapGeometry = {
  boundary: { bottom: number; centerX: number; height: number; left: number; right: number; top: number; width: number };
  map: { bottom: number; height: number; left: number; right: number; top: number; width: number };
  marker: { centerX: number; centerY: number };
  /** Every marker's center, keyed by its accessible name, so cameras compare the same establishment. */
  markers: Record<string, { centerX: number; centerY: number }>;
};

/**
 * Mocks an admin session with `enterprises` on the map and signs in. Every other operational
 * endpoint answers with an empty list unless a test routes it again afterwards (later routes win).
 */
export async function configureAdminMapSession(
  page: Page,
  options: {
    theme?: "dark" | "light";
    followSystem?: boolean;
    viewport?: { height: number; width: number };
    enterprises?: MapEnterprise[];
    insights?: (params: URLSearchParams) => VisitorInsights;
    /** More routes, registered after the catch-all mocks so they take precedence. */
    extraRoutes?: (page: Page) => Promise<void>;
  } = {},
) {
  const colorScheme = options.theme ?? "light";
  if (options.followSystem) await page.emulateMedia({ colorScheme });
  const theme = options.followSystem ? "system" : colorScheme;

  await page.setViewportSize(options.viewport ?? { width: 1920, height: 1080 });
  await page.route(/https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/, (route) => {
    expect(new URL(route.request().url()).searchParams.get("key")).toBe("carto-e2e-test-key");
    return route.fulfill({ status: 200, contentType: "image/png", body: transparentPng });
  });
  await page.route("**/operational/**", (route) => route.fulfill(json([])));
  await page.route("**/activity-logs**", (route) => route.fulfill(json([])));
  await mockPortalSession(page, adminUser, { theme, signedIn: false, token: "map-camera-token" });
  await page.route("**/accounts/enterprises", (route) => route.fulfill(json([])));
  await page.route("**/operational/map-enterprises", (route) => route.fulfill(json(options.enterprises ?? [mapEnterprise])));
  await page.route("**/operational/visitor-insights**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const range = (params.get("range") ?? "today") as VisitorInsights["range"];
    return route.fulfill(json(options.insights?.(params) ?? visitorInsights(range)));
  });
  // Most Visited's ranking: nothing counted unless a test serves its own.
  await page.route("**/operational/visitor-insights/ranking**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill(json({ start: params.get("start"), end: params.get("end"), reportMonths: [], cameraDays: 1, includesToday: true, uncoveredDays: 0, enterprises: [] }));
  });
  await options.extraRoutes?.(page);

  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(adminUser.email);
  await page.getByLabel("Password", { exact: true }).fill("Map camera verification passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await waitForMapReady(page);
}

export async function waitForMapReady(page: Page) {
  const map = page.locator("#admin-enterprise-map");
  await expect(map).toBeVisible();
  await expect(map).toHaveCSS("visibility", "visible");
  await expect(page.locator("#admin-enterprise-map path.tanaw-boundary-path").first()).toBeVisible();
  await expect(page.locator("#admin-enterprise-map .leaflet-marker-icon").first()).toBeVisible();
  await waitForMapToSettle(page);
}

/**
 * Waits until the map has stopped moving: no transform transition or animation is running inside it
 * (Leaflet animates zoom with CSS transform transitions) and the boundary and markers stay identical for 100 ms of
 * samples taken by the test runner. Checking running transitions catches a marker still sliding into
 * place after the boundary has landed, which position samples alone can miss. Sampling from the runner
 * keeps working when a test pauses the page clock.
 */
export async function waitForMapToSettle(page: Page, timeoutMs = 10_000) {
  const sample = () =>
    page.evaluate(() => {
      const map = document.querySelector("#admin-enterprise-map");
      // Only movement counts: tile fade-ins change opacity, not where anything is drawn.
      const animating = (map?.getAnimations({ subtree: true }) ?? []).some((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (animation.playState !== "running" || animation.effect?.getComputedTiming().endTime === Infinity) return false;
        if (!target || target.classList.contains("leaflet-tile")) return false;
        return !(animation instanceof CSSTransition) || animation.transitionProperty === "transform";
      });
      const signature = Array.from(document.querySelectorAll<Element>("#admin-enterprise-map path.tanaw-boundary-path, #admin-enterprise-map .leaflet-marker-icon"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return `${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
        })
        .join("|");
      return { animating, signature };
    });
  const deadline = Date.now() + timeoutMs;
  let previous = await sample();
  let stillSince = previous.animating ? null : Date.now();
  while (stillSince === null || Date.now() - stillSince < 100) {
    if (Date.now() > deadline) throw new Error(`The admin map kept moving for ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = await sample();
    if (current.animating || current.signature !== previous.signature) stillSince = current.animating ? null : Date.now();
    else stillSince ??= Date.now();
    previous = current;
  }
}

/** Reads the map once the camera and markers have stopped moving. */
export async function readSettledMapGeometry(page: Page): Promise<MapGeometry> {
  await waitForMapToSettle(page);
  return readMapGeometry(page);
}

/**
 * Waits for a camera move that an action started (it may begin a few frames later), then for it
 * to settle, and returns where it ended.
 */
export async function readCameraAfterChange(page: Page, from: MapGeometry): Promise<MapGeometry> {
  await expect.poll(async () => Math.abs((await readMapGeometry(page)).boundary.width - from.boundary.width), { message: "the map camera should move" }).toBeGreaterThan(1);
  return readSettledMapGeometry(page);
}

export async function readMapGeometry(page: Page): Promise<MapGeometry> {
  return page.evaluate(() => {
    const mapElement = document.querySelector<HTMLElement>("#admin-enterprise-map");
    const marker = document.querySelector<HTMLElement>("#admin-enterprise-map .leaflet-marker-icon");
    const pathRects = Array.from(document.querySelectorAll<SVGPathElement>("#admin-enterprise-map path.tanaw-boundary-path"))
      .map((path) => path.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    if (!mapElement || !marker || pathRects.length === 0) {
      throw new Error("Admin map geometry is not ready.");
    }

    const map = mapElement.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const left = Math.min(...pathRects.map((rect) => rect.left));
    const right = Math.max(...pathRects.map((rect) => rect.right));
    const top = Math.min(...pathRects.map((rect) => rect.top));
    const bottom = Math.max(...pathRects.map((rect) => rect.bottom));

    return {
      boundary: { bottom, centerX: (left + right) / 2, height: bottom - top, left, right, top, width: right - left },
      map: { bottom: map.bottom, height: map.height, left: map.left, right: map.right, top: map.top, width: map.width },
      marker: { centerX: markerRect.left + markerRect.width / 2, centerY: markerRect.top + markerRect.height / 2 },
      markers: Object.fromEntries(
        Array.from(document.querySelectorAll<HTMLElement>("#admin-enterprise-map .leaflet-marker-icon[aria-label]")).map((element) => {
          const rect = element.getBoundingClientRect();
          return [element.getAttribute("aria-label")!, { centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 }];
        }),
      ),
    };
  });
}

export function expectCanonicalCitywideFraming(geometry: MapGeometry) {
  const usableCenterX = (geometry.map.left + geometry.map.right) / 2;

  expect(geometry.boundary.width).toBeGreaterThan(geometry.map.width * 0.25);
  expect(geometry.boundary.left).toBeGreaterThan(geometry.map.left + 4);
  expect(geometry.boundary.top).toBeGreaterThan(geometry.map.top + 4);
  expect(geometry.boundary.bottom).toBeLessThan(geometry.map.bottom - 4);
  expect(Math.abs(geometry.boundary.centerX - usableCenterX)).toBeLessThan(Math.max(60, geometry.map.width * 0.09));
}

export function expectSameCamera(actual: MapGeometry, expected: MapGeometry) {
  expect(actual.boundary.left).toBeCloseTo(expected.boundary.left, 0);
  expect(actual.boundary.top).toBeCloseTo(expected.boundary.top, 0);
  expect(actual.boundary.width).toBeCloseTo(expected.boundary.width, 0);
  expect(actual.boundary.height).toBeCloseTo(expected.boundary.height, 0);
  // Markers are re-added when the view changes, so the first marker can be another establishment.
  const shared = Object.keys(expected.markers).filter((label) => label in actual.markers);
  expect(shared.length).toBeGreaterThan(0);
  for (const label of shared) {
    expect(actual.markers[label].centerX, label).toBeCloseTo(expected.markers[label].centerX, 0);
    expect(actual.markers[label].centerY, label).toBeCloseTo(expected.markers[label].centerY, 0);
  }
}
