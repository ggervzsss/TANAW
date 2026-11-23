import { expect, test, type Page } from "@playwright/test";
import type { AccountSummary, MapEnterprise } from "../../src/shared/types";
import { json, mockPortalSession, portalUser } from "./support/session";

// Registered Enterprises (/admin/enterprises) and Enterprise Details (/admin/enterprises/:id),
// from the list through its filters to one enterprise's details.

const adminUser = portalUser("admin", { id: "admin-enterprises-test", email: "admin-enterprises@example.test", firstName: "LGU", lastName: "Admin" });

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function localDay(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00+08:00`;
}

function monitoring(cameras: Array<{ name: string; status: "running" | "error" | "starting" | "stopped" }>): MapEnterprise["cameraMonitoring"] {
  const count = (status: string) => cameras.filter((camera) => camera.status === status).length;
  return {
    status: count("error") > 0 ? "error" : count("running") === cameras.length ? "running" : "partial",
    configuredCameraCount: cameras.length,
    activeCameraCount: count("running") + count("starting"),
    healthyCameraCount: count("running"),
    startingCameraCount: count("starting"),
    stoppedCameraCount: count("stopped"),
    errorCameraCount: count("error"),
    cameras: cameras.map((camera, index) => ({ cameraId: index + 1, cameraName: camera.name, status: camera.status, running: camera.status === "running", error: camera.status === "error" ? "Stream lost" : null })),
  };
}

const base = { lat: 14.35, lng: 121.05, occupancyStatus: "Normal" as const, fullAddress: "Address not provided" };

const mapEnterprises: MapEnterprise[] = [
  {
    ...base,
    id: "ENT-PLAZA",
    name: "City Plaza",
    barangay: "Poblacion",
    category: "Parks",
    totalLiveOccupancy: 60,
    estimatedUniqueCount: 4464,
    monitoringStatus: "Partially Monitoring",
    gatewayStatus: "Connected",
    lastSync: minutesAgo(1),
    cameraMonitoring: monitoring([
      { name: "Main Entrance", status: "running" },
      { name: "Side Entrance", status: "running" },
      { name: "Parking Area", status: "error" },
    ]),
  },
  {
    ...base,
    id: "ENT-SPORTS",
    name: "Pacita Sports Complex",
    barangay: "Pacita I",
    category: "Sports Complex",
    totalLiveOccupancy: null,
    estimatedUniqueCount: 120,
    monitoringStatus: "Offline",
    gatewayStatus: "Offline",
    lastSync: minutesAgo(90),
    cameraMonitoring: monitoring([
      { name: "Gate", status: "running" },
      { name: "Court", status: "running" },
    ]),
  },
  {
    ...base,
    id: "ENT-MUSEUM",
    name: "Museo ng San Pedro",
    barangay: "San Antonio",
    category: "Museum",
    totalLiveOccupancy: 12,
    estimatedUniqueCount: 80,
    monitoringStatus: "Fully Monitoring",
    gatewayStatus: "Connected",
    lastSync: minutesAgo(1),
    cameraMonitoring: monitoring([{ name: "Lobby", status: "running" }]),
  },
];

function account(enterpriseId: string, name: string, attraction: AccountSummary["attraction"], address: string): AccountSummary {
  return {
    id: `account-${enterpriseId}`,
    email: `${enterpriseId.toLowerCase()}@example.test`,
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseName: name,
    category: attraction?.category ?? null,
    attraction,
    attractionDescription: null,
    managerName: null,
    barangay: null,
    address,
    latitude: 14.35,
    longitude: 121.05,
    locationUpdatedAt: null,
    enterpriseId,
    gatewayStatus: null,
    buildingCapacity: 200,
    displayName: name,
    role: "enterprise",
    title: "Enterprise",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2025-01-15T08:00:00+08:00",
    lastLoginAt: null,
  };
}

const accounts = [
  account("ENT-PLAZA", "City Plaza", { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" }, "Barangay Poblacion, San Pedro, Laguna 4023"),
  account("ENT-SPORTS", "Pacita Sports Complex", { code: "405", typeCode: "4", type: "Sports and Recreational Facilities", category: "Sports Complex", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD412" }, "Pacita Avenue, San Pedro, Laguna"),
  account("ENT-MUSEUM", "Museo ng San Pedro", { code: "205", typeCode: "2", type: "History and Culture", category: "Museum", portfolioCategory: "Cultural Tourism", ntdpCode: "TD213" }, "Barangay San Antonio, San Pedro, Laguna"),
];

function insights(range: string) {
  const series =
    range === "today"
      ? [
          { startAt: localDay(0), label: "8 AM", averageVisitors: 20, peakVisitors: 29, estimatedUniqueCount: 288 },
          { startAt: localDay(0), label: "6 PM", averageVisitors: 80, peakVisitors: 96, estimatedUniqueCount: 4000 },
        ]
      : [
          { startAt: localDay(3), label: "", averageVisitors: 40, peakVisitors: 90, estimatedUniqueCount: 11240 },
          { startAt: localDay(1), label: "", averageVisitors: 30, peakVisitors: 70, estimatedUniqueCount: 6300 },
        ];
  return {
    range,
    scopeType: "enterprise",
    scopeId: "ENT-PLAZA",
    scopeName: "City Plaza",
    currentVisitors: 60,
    typicalVisitors: null,
    differencePercent: null,
    comparisonMessage: "",
    busiestEnterprise: null,
    busiestPeriodLabel: null,
    series,
    unusuallyBusy: [],
    lastUpdatedAt: minutesAgo(1),
  };
}

const intakeReport = {
  id: "report-plaza-oct",
  enterpriseId: "ENT-PLAZA",
  enterprise: "City Plaza",
  category: "Parks",
  attraction: accounts[0]?.attraction,
  barangay: "Poblacion",
  month: "October",
  period: "October 2026",
  submitted: "2026-11-05",
  submittedAt: "2026-11-05T09:00:00+08:00",
  status: "Pending Review",
  code: "RPT-1",
  metrics: { entry: null, exit: null, unique: 259600, peak: "320" },
};

async function openEnterprises(page: Page, path = "/admin/enterprises") {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/operational/**", (route) => route.fulfill(json([])));
  await page.route("**/activity-logs**", (route) => route.fulfill(json([])));
  await mockPortalSession(page, adminUser);
  await page.route("**/accounts/enterprises", (route) => route.fulfill(json(accounts)));
  await page.route("**/operational/map-enterprises", (route) => route.fulfill(json(mapEnterprises)));
  await page.route("**/operational/reports/intake", (route) => route.fulfill(json([intakeReport])));
  await page.route("**/operational/visitor-insights**", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("enterpriseId")).toBe("ENT-PLAZA");
    return route.fulfill(json(insights(url.searchParams.get("range") ?? "today")));
  });
  await page.goto(path);
}

test("Admin filters the registered enterprises and opens one enterprise's details", async ({ page }) => {
  await openEnterprises(page);

  await expect(page.getByRole("heading", { level: 1, name: "Registered Enterprises" })).toBeVisible();
  await expect(page.getByText("Camera status is live.")).toBeVisible();
  const figures = page.locator("dl").first();
  await expect(figures.getByText("Registered enterprises").locator("..")).toContainText("3");
  await expect(figures).toContainText("3 running right now, 3 not reporting");
  await expect(figures.getByText("Needs attention").locator("..")).toContainText("2");

  const table = page.getByRole("table");
  const plaza = table.getByRole("row", { name: /City Plaza/ });
  await expect(plaza).toContainText("411");
  await expect(plaza).toContainText("Sports and Recreational Facilities");
  await expect(plaza).toContainText("3 cameras");
  await expect(plaza).toContainText("1 camera not reporting");
  await expect(table.getByRole("row", { name: /Pacita Sports Complex/ })).toContainText(/No connection since/);
  await expect(table.getByRole("row", { name: /Museo ng San Pedro/ })).toContainText("Monitoring");
  await expect(page.getByRole("status").filter({ hasText: "3 enterprises found" })).toBeVisible();

  // Needs attention, then remove the chip.
  await page.getByRole("button", { name: "Show these 2" }).click();
  await expect(page.getByText("2 of 3 enterprises need attention")).toBeVisible();
  await expect(table.getByRole("row", { name: /Museo ng San Pedro/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove filter: Needs attention" }).click();
  await expect(page.getByText("3 enterprises found")).toBeVisible();

  // Dropdown and search filters actually filter.
  await page.getByRole("combobox", { name: "Attraction type" }).click();
  await page.getByRole("option", { name: "History and Culture" }).click();
  await expect(table.getByRole("row", { name: /Museo ng San Pedro/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /City Plaza/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).first().click();

  await page.getByRole("combobox", { name: "Camera status" }).click();
  await page.getByRole("option", { name: "Camera issue" }).click();
  await expect(page.getByText("1 of 3 enterprises found")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search enterprises" }).fill("museo");
  await expect(page.getByText("No enterprises match these filters")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search enterprises" }).fill("plaza");
  await expect(page).toHaveURL(/camera=issue/);

  // Details.
  await page.getByRole("link", { name: "View details for City Plaza" }).click();
  await expect(page).toHaveURL(/\/admin\/enterprises\/ENT-PLAZA$/);
  await expect(page.getByRole("heading", { level: 1, name: "City Plaza" })).toBeVisible();
  await expect(page.getByText("Barangay Poblacion, San Pedro, Laguna 4023")).toBeVisible();
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByText("Parking Area is not responding")).toBeVisible();
  await expect(page.getByText(/^Today, /)).toBeVisible();

  const detailFigures = page.locator("dl").first();
  await expect(detailFigures).toContainText("2/3");
  await expect(detailFigures).toContainText("Parking Area not counting");
  await expect(detailFigures).toContainText("4,464");
  await expect(detailFigures).toContainText("60");

  await expect(page.getByRole("heading", { level: 2, name: "Today’s Trend" })).toBeVisible();
  await expect(page.getByText(/Busiest: 6 PM · 96 visitors inside at peak/)).toBeVisible();
  await page.getByRole("radio", { name: "Daily" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Last 30 Days" })).toBeVisible();
  await expect(page.getByText(/^Busiest: .* · 11,240 visitors/)).toBeVisible();
  await page.getByRole("radio", { name: "Monthly" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Monthly Trend" })).toBeVisible();
  await expect(page.getByText(/Busiest: October 2026 · 259,600 visitors/)).toBeVisible();
  await expect(page).toHaveURL(/trend=monthly/);

  const locations = page.getByRole("region", { name: "Monitored Locations" });
  await expect(locations.getByRole("listitem").filter({ hasText: "Main Entrance" })).toContainText("Monitoring");
  const parking = locations.getByRole("listitem").filter({ hasText: "Parking Area" });
  await expect(parking).toContainText("Not responding");
  await expect(parking.getByRole("link", { name: "Message IT about Parking Area" })).toHaveAttribute("href", "/admin/requests");

  // Back to the list keeps the filters.
  await page.getByRole("link", { name: "Back to Registered Enterprises" }).click();
  await expect(page).toHaveURL(/\/admin\/enterprises\?.*camera=issue/);
  await expect(page.getByRole("searchbox", { name: "Search enterprises" })).toHaveValue("plaza");
});

test("Enterprise Details explains an unknown enterprise ID", async ({ page }) => {
  await openEnterprises(page, "/admin/enterprises/ENT-MISSING");
  await expect(page.getByRole("heading", { level: 1, name: "Enterprise not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to Registered Enterprises" }).click();
  await expect(page).toHaveURL(/\/admin\/enterprises$/);
  await expect(page.getByRole("heading", { level: 1, name: "Registered Enterprises" })).toBeVisible();
});
