// Admin Map View Spatial Directory: previews, barangay focus, search, and keyboard selection.
import { expect, test } from "@playwright/test";
import type { MapEnterprise } from "../../src/shared/types";
import { mapEnterprise, configureAdminMapSession, readSettledMapGeometry, readMapGeometry, expectCanonicalCitywideFraming, expectSameCamera } from "./support/adminMap";

test("switches between enterprise previews, reports missing telemetry, and preserves the camera with the directory visible", async ({ page }, testInfo) => {
  // Several previews, panel toggles and settled camera readings take longer than the default.
  test.setTimeout(60_000);
  const offlineEnterprise: MapEnterprise = {
    ...mapEnterprise,
    id: "offline-enterprise",
    name: "Offline Enterprise",
    lng: mapEnterprise.lng + 0.006,
    monitoringStatus: "Offline",
    occupancyStatus: "No Data",
    totalLiveOccupancy: null,
    cameraMonitoring: null,
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
  await expect
    .poll(async () => {
      const [contact, hours] = await Promise.all([contactCard.boundingBox(), hoursCard.boundingBox()]);
      return contact && hours ? Math.abs(contact.y - hours.y) : Infinity;
    })
    .toBeLessThan(0.5);
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
