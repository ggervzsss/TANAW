// Admin Map View camera: framing, zoom, drag, idle return, and tooltips.
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
  // Hold still before releasing, as a person placing the map would, so the drag ends without a fling.
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(popup).toHaveAttribute("data-placement", "below");
  const previewBounds = (await popup.boundingBox())!;
  expect(previewBounds.x).toBeGreaterThanOrEqual(geometry.map.left + 10);
  expect(previewBounds.x + previewBounds.width).toBeLessThan(geometry.map.right);
  expect(previewBounds.y + previewBounds.height).toBeLessThan(geometry.map.bottom);
  await expect(popup.getByRole("button", { name: "View Details" })).toBeVisible();
});

test("fits the city on entry and keeps that camera across navigation and reload", async ({ page }) => {
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
});

test("returns to the citywide camera from every All Barangays action", async ({ page }) => {
  test.setTimeout(60_000);
  await configureAdminMapSession(page);
  const initial = await readSettledMapGeometry(page);
  expectCanonicalCitywideFraming(initial);

  const barangaySelect = page.getByRole("combobox", { name: "Select barangay" });
  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await expect(barangaySelect).toContainText("Barangay San Antonio");
  const backToDirectory = page.getByRole("button", { name: "All Barangays", exact: true });
  await expect(backToDirectory).toContainText("All Barangays");
  await expect(page.getByRole("heading", { name: "Barangay San Antonio" })).toBeVisible();
  const filteredCamera = await readCameraAfterChange(page, initial);
  await backToDirectory.click();
  await expect(barangaySelect).toContainText("All Barangays");
  const backCamera = await readCameraAfterChange(page, filteredCamera);
  expect(backCamera.boundary.width).toBeLessThan(filteredCamera.boundary.width);
  expectSameCamera(backCamera, initial);

  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  const dropdownCamera = await readCameraAfterChange(page, backCamera);
  await barangaySelect.click();
  await page.getByRole("option", { name: /All Barangays/ }).click();
  await expect(barangaySelect).toContainText("All Barangays");
  const dropdownReset = await readCameraAfterChange(page, dropdownCamera);
  expect(dropdownReset.boundary.width).toBeLessThan(dropdownCamera.boundary.width);
  expectSameCamera(dropdownReset, backCamera);

  await barangaySelect.click();
  await page.getByRole("option", { name: /Barangay San Antonio/ }).click();
  await expect(barangaySelect).toContainText("Barangay San Antonio");
  const outsideClickCamera = await readCameraAfterChange(page, dropdownReset);

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

test("refits the city and keeps the topbar on one line when the window resizes", async ({ page }) => {
  await configureAdminMapSession(page);
  const map = page.locator("#admin-enterprise-map");
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(map.locator("path.tanaw-boundary-path")).toHaveCount(28);
  // The map refits after the resize is observed, so retry until that refit has landed.
  await expect(async () => expectCanonicalCitywideFraming(await readSettledMapGeometry(page))).toPass();
  await page.setViewportSize({ width: 1280, height: 800 });
  const accountButton = (await page.getByRole("button", { name: "Open account menu" }).boundingBox())!;
  const insightsLink = (await page.getByRole("link", { name: "Visitor Insights" }).boundingBox())!;
  expect(insightsLink.x + insightsLink.width).toBeLessThan(accountButton.x);
  expect(accountButton.x + accountButton.width).toBeLessThanOrEqual(1280);
  await expect(page.getByRole("link", { name: "Alerts & Requests" })).toHaveCSS("white-space", "nowrap");
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
