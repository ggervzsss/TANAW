import { expect, test, type Page } from "@playwright/test";
import type { AccountSummary, MapEnterprise } from "../../src/shared/types";
import { json, mockPortalSession, portalUser } from "./support/session";

// Registered Enterprises (/admin/enterprises) and Enterprise Details (/admin/enterprises/:id),
// from the list through its filters to one enterprise's details.

const adminUser = portalUser("admin", { id: "admin-enterprises-test", email: "admin-enterprises@example.test", firstName: "LGU", lastName: "Admin" });

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const pad = (value: number) => String(value).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The local ISO day `offsetDays` before today. */
function isoDay(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDay(offsetDays: number, hour = 0) {
  return `${isoDay(offsetDays)}T${pad(hour)}:00:00+08:00`;
}

/** "Nov 3" for a local ISO day, with the year when it is not this year. */
function shortDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const text = `${MONTHS[(month ?? 1) - 1].slice(0, 3)} ${day}`;
  return year === new Date().getFullYear() ? text : `${text}, ${year}`;
}

const today = new Date();
const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const lastMonthName = `${MONTHS[lastMonth.getMonth()]} ${lastMonth.getFullYear()}`;
const lastMonthKey = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}`;

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

/** Weekdays 8 AM to 12 PM and 1 PM to 5 PM, Saturday 8 AM to 9 PM, closed on Sunday. */
const plazaHours: NonNullable<AccountSummary["openingHours"]> = {
  days: (["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const).map((day) =>
    day === "sunday"
      ? { day, mode: "closed" as const, periods: [] }
      : day === "saturday"
        ? { day, mode: "hours" as const, periods: [{ open: "08:00", close: "21:00" }] }
        : {
            day,
            mode: "hours" as const,
            periods: [
              { open: "08:00", close: "12:00" },
              { open: "13:00", close: "17:00" },
            ],
          },
  ),
};

/** An upcoming closure the enterprise marked from the desktop app (under its account name). */
const plazaClosures = [{ id: "closure-plaza", startDate: isoDay(-26), endDate: isoDay(-28), reason: "Pond cleaning", createdBy: "City Plaza" }];

const accounts = [
  {
    ...account("ENT-PLAZA", "City Plaza", { code: "411", typeCode: "4", type: "Sports and Recreational Facilities", category: "Parks", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD409" }, "Barangay Poblacion, San Pedro, Laguna 4023"),
    openingHours: plazaHours,
  },
  account("ENT-SPORTS", "Pacita Sports Complex", { code: "405", typeCode: "4", type: "Sports and Recreational Facilities", category: "Sports Complex", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD412" }, "Pacita Avenue, San Pedro, Laguna"),
  account("ENT-MUSEUM", "Museo ng San Pedro", { code: "205", typeCode: "2", type: "History and Culture", category: "Museum", portfolioCategory: "Cultural Tourism", ntdpCode: "TD213" }, "Barangay San Antonio, San Pedro, Laguna"),
];

/** Camera counts by date: today and three days ago by hour, longer ranges by day. */
function insights(start: string | null, end: string | null) {
  const series =
    start !== end
      ? [
          { startAt: localDay(3), label: "", averageVisitors: 40, peakVisitors: 90, estimatedUniqueCount: 11240 },
          { startAt: localDay(1), label: "", averageVisitors: 30, peakVisitors: 70, estimatedUniqueCount: 6300 },
        ]
      : start === isoDay(0)
        ? [
            { startAt: localDay(0, 8), label: "8 AM", averageVisitors: 20, peakVisitors: 29, estimatedUniqueCount: 288 },
            { startAt: localDay(0, 18), label: "6 PM", averageVisitors: 80, peakVisitors: 96, estimatedUniqueCount: 4000 },
          ]
        : start === isoDay(3)
          ? [
              { startAt: localDay(3, 10), label: "10 AM", averageVisitors: 30, peakVisitors: 41, estimatedUniqueCount: 500 },
              { startAt: localDay(3, 15), label: "3 PM", averageVisitors: 60, peakVisitors: 77, estimatedUniqueCount: 11240 },
            ]
          : [];
  return {
    range: null,
    start,
    end,
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

/**
 * Visitor totals per enterprise, as the server ranks them: last month as a whole from its report,
 * anything else from camera counts.
 */
function ranking(start: string | null, end: string | null) {
  const wholeLastMonth = start === `${lastMonthKey}-01` && end?.startsWith(lastMonthKey);
  return {
    start,
    end,
    reportMonths: wholeLastMonth ? [lastMonthKey] : [],
    cameraDays: wholeLastMonth ? 0 : 7,
    includesToday: !wholeLastMonth,
    uncoveredDays: 0,
    enterprises: [
      { enterpriseId: "ENT-PLAZA", enterpriseName: "City Plaza", barangay: "Poblacion", category: "Parks", visitors: wholeLastMonth ? 259600 : 17540 },
      { enterpriseId: "ENT-MUSEUM", enterpriseName: "Museo ng San Pedro", barangay: "San Antonio", category: "Museum", visitors: 900 },
    ],
  };
}

const intakeReport = {
  id: "report-plaza-last-month",
  enterpriseId: "ENT-PLAZA",
  enterprise: "City Plaza",
  category: "Parks",
  attraction: accounts[0]?.attraction,
  barangay: "Poblacion",
  month: MONTHS[lastMonth.getMonth()],
  period: lastMonthName,
  submitted: isoDay(0),
  submittedAt: localDay(0, 9),
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
  await page.route("**/accounts/enterprises/*/closures", (route) => route.fulfill(json(route.request().url().includes("account-ENT-PLAZA") ? plazaClosures : [])));
  await page.route("**/operational/map-enterprises", (route) => route.fulfill(json(mapEnterprises)));
  await page.route("**/operational/reports/intake", (route) => route.fulfill(json([intakeReport])));
  await page.route("**/operational/visitor-insights**", (route) => {
    const url = new URL(route.request().url());
    const [start, end] = [url.searchParams.get("start"), url.searchParams.get("end")];
    if (url.pathname.endsWith("/visitor-insights/ranking")) return route.fulfill(json(ranking(start, end)));
    expect(url.searchParams.get("enterpriseId")).toBe("ENT-PLAZA");
    expect(url.searchParams.has("range")).toBe(false);
    return route.fulfill(json(insights(start, end)));
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

  // Details: the whole row opens them, not just the name.
  const plazaRow = page.getByRole("row", { name: /City Plaza/ });
  await expect(plazaRow.getByRole("link", { name: "City Plaza" })).toHaveAttribute("href", "/admin/enterprises/ENT-PLAZA");
  await expect(plazaRow.getByText("View details")).toHaveCount(0);
  await plazaRow.getByRole("cell").nth(1).click();
  await expect(page).toHaveURL(/\/admin\/enterprises\/ENT-PLAZA$/);
  await expect(page.getByRole("heading", { level: 1, name: "City Plaza" })).toBeVisible();
  await expect(page.getByText("Barangay Poblacion, San Pedro, Laguna 4023")).toBeVisible();
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByText("Parking Area is not responding")).toBeVisible();

  // Today by default: live figures, today's total and today's hours.
  const rangeButton = page.getByRole("button", { name: "Today", exact: true });
  await expect(rangeButton).toBeVisible();
  const detailFigures = page.locator("dl").first();
  await expect(detailFigures).toContainText("2/3");
  await expect(detailFigures).toContainText("Parking Area not counting");
  await expect(detailFigures).toContainText("Visitors today");
  await expect(detailFigures).toContainText("4,464");
  await expect(detailFigures).toContainText("60");
  await expect(detailFigures).toContainText("Busiest hour");
  await expect(detailFigures).toContainText("6 PM");
  await expect(detailFigures.getByText("Now", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("heading", { level: 2, name: "Today’s Trend" })).toBeVisible();
  await expect(page.getByText(/Busiest: 6 PM · 96 visitors inside at peak/)).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Trend period" })).toHaveCount(0);

  // The last 7 days: the total, busiest day and trend follow the range; live figures say "Now".
  await rangeButton.click();
  const picker = page.getByRole("dialog", { name: "Choose a date range for City Plaza" });
  await picker.getByRole("button", { name: "Last 7 days" }).click();
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`range=last7&from=${isoDay(6)}&to=${isoDay(0)}`));
  await expect(detailFigures).toContainText("estimated unique visitors in the last 7 days");
  await expect(detailFigures).toContainText("17,540");
  await expect(detailFigures).toContainText("From camera counts");
  await expect(detailFigures.getByText("Now", { exact: true })).toHaveCount(2);
  await expect(detailFigures).toContainText("2/3");
  await expect(detailFigures).toContainText("Busiest day");
  await expect(detailFigures).toContainText(`${shortDay(isoDay(3))} · 11,240 visitors`);
  await expect(page.getByRole("heading", { level: 2, name: "Daily Trend" })).toBeVisible();
  await expect(page.getByText(/^Busiest: .* · 11,240 visitors/)).toBeVisible();
  await expect(page.getByText("Cameras at this enterprise, as they are now.")).toBeVisible();
  await page.getByRole("radio", { name: "Monthly" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Monthly Trend" })).toBeVisible();
  await expect(page).toHaveURL(/trend=monthly/);

  // Last month as a whole: the total and the monthly trend come from its report.
  await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
  await picker.getByRole("group", { name: "Quick ranges" }).getByRole("button", { name: "Month" }).click();
  await picker.getByRole("button", { name: "Previous month" }).click();
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/range=month&from=/);
  await expect(page.getByRole("button", { name: lastMonthName, exact: true })).toBeVisible();
  await expect(detailFigures).toContainText(`estimated unique visitors in ${lastMonthName}`);
  await expect(detailFigures).toContainText("259,600");
  await expect(detailFigures).toContainText("From the monthly report");
  await page.getByRole("radio", { name: "Monthly" }).click();
  await expect(page.getByText(`Busiest: ${lastMonthName} · 259,600 visitors`)).toBeVisible();

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

test("Enterprise Details shows a past day from the address, within the camera history", async ({ page }) => {
  // Three days ago: that day's hours, its busiest hour and its total; cameras and occupancy stay live.
  await openEnterprises(page, `/admin/enterprises/ENT-PLAZA?range=custom&from=${isoDay(3)}&to=${isoDay(3)}`);
  await expect(page.getByRole("heading", { level: 1, name: "City Plaza" })).toBeVisible();
  const day = shortDay(isoDay(3));
  const figures = page.locator("dl").first();
  await expect(page.getByRole("heading", { level: 2, name: `Trend on ${day}` })).toBeVisible();
  await expect(page.getByText(`Busiest: 3 PM · 77 visitors inside at peak. Most visitors inside at once in each hour on ${day}.`)).toBeVisible();
  await expect(figures).toContainText(`estimated unique visitors on ${day}`);
  await expect(figures).toContainText("17,540");
  await expect(figures).toContainText("Busiest hour");
  await expect(figures).toContainText("3 PM");
  await expect(figures.getByText("Now", { exact: true })).toHaveCount(2);
  await expect(figures).toContainText("visitors inside now");

  // Forty days ago is older than the camera history: no hourly chart, and the page says why.
  await page.goto(`/admin/enterprises/ENT-PLAZA?range=custom&from=${isoDay(40)}&to=${isoDay(40)}`);
  await expect(page.getByText(/^Camera history covers the last 30 days, so there are no camera counts on /)).toBeVisible();
  await expect(figures).toContainText("Camera history covers the last 30 days only");

  // A malformed range falls back to today.
  await page.goto("/admin/enterprises/ENT-PLAZA?range=custom&from=2026-13-40&to=nope");
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Today’s Trend" })).toBeVisible();
});

test("Enterprise Details shows the opening hours and temporary closures, read-only", async ({ page }) => {
  await openEnterprises(page, "/admin/enterprises/ENT-PLAZA");
  await expect(page.getByRole("heading", { level: 1, name: "City Plaza" })).toBeVisible();

  // Compact times, a split day joined with "and", and today's row marked.
  const hours = page.getByRole("region", { name: "Opening Hours" });
  const monday = hours.getByRole("listitem").filter({ hasText: "Monday" });
  await expect(monday).toContainText("8 AM to 12 PM and 1 PM to 5 PM");
  await expect(monday).toContainText("Lunch break");
  await expect(hours.getByRole("listitem").filter({ hasText: "Saturday" })).toContainText("8 AM to 9 PM");
  await expect(hours.getByRole("listitem").filter({ hasText: "Sunday" })).toContainText("Closed");
  await expect(hours.locator('[aria-current="date"]')).toContainText("(today)");
  await expect(hours.getByText(/^(Open now, until|Closed now, opens) /)).toBeVisible();
  await expect(hours.getByRole("button")).toHaveCount(0);

  const closures = page.getByRole("region", { name: "Temporary Closures" });
  const closure = closures.getByRole("listitem");
  await expect(closure).toHaveCount(1);
  await expect(closure).toContainText("Upcoming");
  await expect(closure).toContainText("Pond cleaning");
  await expect(closure).toContainText("Marked by City Plaza from the desktop app");
  await expect(closures.getByRole("button")).toHaveCount(0);
});

test("Enterprise Details explains an unknown enterprise ID", async ({ page }) => {
  await openEnterprises(page, "/admin/enterprises/ENT-MISSING");
  await expect(page.getByRole("heading", { level: 1, name: "Enterprise not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to Registered Enterprises" }).click();
  await expect(page).toHaveURL(/\/admin\/enterprises$/);
  await expect(page.getByRole("heading", { level: 1, name: "Registered Enterprises" })).toBeVisible();
});
