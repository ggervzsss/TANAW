// Admin Dashboard map camera: framing, zoom, drag, barangay drill-in and theme changes.
import { expect, test } from "@playwright/test";
import {
  mapEnterprise,
  transparentPng,
  configureAdminMapSession,
  waitForMapReady,
  readSettledMapGeometry,
  readCameraAfterChange,
  readMapGeometry,
  expectCanonicalCitywideFraming,
  expectSameCamera,
  type MapGeometry,
} from "./support/adminMap";

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

const neighbour = { ...mapEnterprise, id: "second-map-enterprise", name: "Second Map Enterprise", lng: mapEnterprise.lng + 0.006, totalLiveOccupancy: 3 };

test("keeps the selected pin's callout above the pin and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureAdminMapSession(page, { viewport: { width: 820, height: 680 } });
  const map = page.locator("#admin-enterprise-map");
  const marker = map.locator(".tanaw-map-pin");
  await marker.click();
  const callout = map.locator(".tanaw-enterprise-callout");
  await expect(callout).toBeVisible();
  await expect(marker).toHaveClass(/is-selected/);
  await expect(marker.locator(".tanaw-enterprise-marker__selection")).toHaveCSS("animation-name", "none");
  await expect(map.locator(".leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const geometry = await readMapGeometry(page);
  const box = (await callout.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(geometry.marker.centerY);
  expect(Math.abs(box.x + box.width / 2 - geometry.marker.centerX)).toBeLessThan(4);
  await callout.getByRole("link").press("Escape");
  await expect(callout).toHaveCount(0);
});

test("fits the city on entry and keeps that camera across navigation and reload", async ({ page }) => {
  test.setTimeout(60_000);
  await configureAdminMapSession(page);
  const initial = await readSettledMapGeometry(page);
  expectCanonicalCitywideFraming(initial);

  await page.getByRole("link", { name: "View all activity" }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await waitForMapReady(page);
  expectSameCamera(await readSettledMapGeometry(page), initial);

  await page.reload();
  await waitForMapReady(page);
  expectSameCamera(await readSettledMapGeometry(page), initial);
});

test("opens a barangay from its busiest pin and returns to the citywide camera from All barangays", async ({ page }) => {
  test.setTimeout(60_000);
  await configureAdminMapSession(page, { enterprises: [mapEnterprise, neighbour] });
  const initial = await readSettledMapGeometry(page);
  const pins = page.locator("#admin-enterprise-map .leaflet-marker-icon");
  await expect(pins).toHaveCount(1);

  await pins.first().click();
  await expect(page.getByRole("heading", { name: "Barangay San Antonio 2 enterprises" })).toBeVisible();
  await expect(page.locator('#admin-enterprise-map .tanaw-boundary-path[data-boundary-state="selected"]')).toHaveCount(1);
  const drilled = await readCameraAfterChange(page, initial);
  expect(drilled.boundary.width).toBeGreaterThan(initial.boundary.width);
  await expect(pins).toHaveCount(2);

  await page.getByRole("button", { name: "All barangays" }).click();
  await expect(page.getByRole("heading", { name: "San Pedro, Laguna" })).toBeVisible();
  const back = await readCameraAfterChange(page, drilled);
  expectSameCamera(back, initial);
  await expect(pins).toHaveCount(1);
  await expect(page.locator('#admin-enterprise-map .tanaw-boundary-path[data-boundary-state="selected"]')).toHaveCount(0);
});

test("refits the city when the window resizes", async ({ page }) => {
  await configureAdminMapSession(page);
  const map = page.locator("#admin-enterprise-map");
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(map.locator("path.tanaw-boundary-path")).toHaveCount(28);
  // The map refits after the resize is observed, so retry until that refit has landed.
  await expect(async () => expectCanonicalCitywideFraming(await readSettledMapGeometry(page))).toPass();
});

test("keeps a manually zoomed map through the display toggles and a staged theme switch", async ({ page }) => {
  // Zooming, dragging and a staged theme switch that waits for map tiles take longer than the default.
  test.setTimeout(60_000);
  const otherBarangay = { ...neighbour, barangay: "Elsewhere", totalLiveOccupancy: 5 };
  await configureAdminMapSession(page, { followSystem: true, enterprises: [mapEnterprise, otherBarangay] });
  const map = page.locator("#admin-enterprise-map");
  const display = page.getByRole("group", { name: "Map display" });
  const labels = display.getByRole("button", { name: "Labels" });
  const boundaries = display.getByRole("button", { name: "Boundaries" });
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
  const dragged = await readSettledMapGeometry(page);
  expect(markerSpacing(dragged)).toBeCloseTo(markerSpacing(zoomed), 0);

  await labels.click();
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveAttribute("data-map-labels", "hidden");
  await expect(page.locator(".tanaw-label-tiles--light")).toHaveCSS("visibility", "hidden");
  expectSameCamera(await readSettledMapGeometry(page), dragged);

  await boundaries.click();
  await expect(boundaries).toHaveAttribute("aria-pressed", "false");
  await expect(map.locator("path.tanaw-boundary-path")).toHaveCount(0);
  await boundaries.click();
  await expect(map.locator("path.tanaw-boundary-path")).toHaveCount(28);
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
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  expectSameCamera(await readSettledMapGeometry(page), dragged);

  // The labels choice is remembered.
  await page.reload();
  await waitForMapReady(page);
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveAttribute("data-map-tiles", "dark");
  await labels.click();
  await expect(map.locator(".tanaw-label-tiles--dark")).toHaveCSS("visibility", "visible");
});
