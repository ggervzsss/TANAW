// Admin Dashboard: map pins and callout, the busy alert, Most Visited, Peak Occupancy and the recent lists.
import { expect, test, type Page } from "@playwright/test";
import type { MapEnterprise, VisitorInsightEnterprise } from "../../src/shared/types";
import { configureAdminMapSession, mapEnterprise, visitorInsights, waitForMapReady } from "./support/adminMap";
import { json, waitForStillPage } from "./support/session";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3));

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

const today = new Date();
const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const previousPeriod = `${MONTHS[previousMonth.getMonth()]} ${previousMonth.getFullYear()}`;

const plaza: MapEnterprise = {
  ...mapEnterprise,
  id: "enterprise-plaza",
  name: "San Antonio Plaza",
  lng: mapEnterprise.lng + 0.003,
  totalLiveOccupancy: 30,
  estimatedUniqueCount: 60,
};
const enterprises = [mapEnterprise, plaza];

function busyEntry(enterpriseId: string, name: string, percent: number): VisitorInsightEnterprise {
  return { enterpriseId, enterpriseName: name, barangay: "San Antonio", currentVisitors: 60, typicalVisitors: 43, differencePercent: percent, activityLevel: "Busier Than Usual" };
}

/** Daily camera history for one enterprise: yesterday and two days ago. */
function dailySeries(unique: number, peaks: [number, number]) {
  return [2, 1].map((ago, index) => ({
    startAt: `${isoDay(daysAgo(ago))}T00:00:00+08:00`,
    label: "",
    averageVisitors: 5,
    peakVisitors: peaks[index],
    estimatedUniqueCount: unique,
  }));
}

async function openDashboard(page: Page, options: { busy?: () => VisitorInsightEnterprise[]; recent?: boolean; theme?: "dark" | "light"; viewport?: { width: number; height: number } } = {}) {
  await configureAdminMapSession(page, {
    enterprises,
    extraRoutes: options.recent ? mockRecentData : undefined,
    theme: options.theme,
    viewport: options.viewport ?? { width: 1440, height: 900 },
    insights: (params) => {
      const range = (params.get("range") ?? "today") as "today" | "7d" | "30d";
      const enterpriseId = params.get("enterpriseId");
      if (enterpriseId === plaza.id) return visitorInsights(range, { scopeType: "enterprise", scopeName: plaza.name, series: dailySeries(100, [44, 52]) });
      if (enterpriseId) return visitorInsights(range, { scopeType: "enterprise", scopeName: mapEnterprise.name, series: dailySeries(40, [18, 20]) });
      if (range === "today") {
        return visitorInsights(range, {
          series: [9, 13, 15].map((hour, index) => ({ startAt: `${isoDay(today)}T${String(hour).padStart(2, "0")}:00:00+08:00`, label: "", averageVisitors: 10, peakVisitors: [20, 74, 31][index] })),
          unusuallyBusy: options.busy?.() ?? [],
        });
      }
      return visitorInsights(range, { series: dailySeries(140, [80, 120]) });
    },
  });
}

/** The server's ranking: a whole past month comes from its report, anything else from camera counts. */
async function mockVisitorRanking(page: Page) {
  const previousMonthKey = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}`;
  await page.route("**/operational/visitor-insights/ranking**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const start = params.get("start") ?? "";
    const end = params.get("end") ?? "";
    const wholePreviousMonth = start === `${previousMonthKey}-01` && end === isoDay(new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0));
    const base = { start, end, includesToday: !wholePreviousMonth, uncoveredDays: 0 };
    return route.fulfill(
      json(
        wholePreviousMonth
          ? { ...base, reportMonths: [previousMonthKey], cameraDays: 0, enterprises: [{ enterpriseId: "enterprise-reported", enterpriseName: "Reported Heritage Park", barangay: "Landayan", category: "Park", visitors: 1240 }] }
          : {
              ...base,
              reportMonths: [],
              cameraDays: 7,
              enterprises: [
                { enterpriseId: plaza.id, enterpriseName: plaza.name, barangay: plaza.barangay, category: plaza.category, visitors: 260 },
                { enterpriseId: mapEnterprise.id, enterpriseName: mapEnterprise.name, barangay: mapEnterprise.barangay, category: mapEnterprise.category, visitors: 104 },
              ],
            },
      ),
    );
  });
}

async function mockRecentData(page: Page) {
  await mockVisitorRanking(page);
  await page.route("**/operational/reports/intake", (route) =>
    route.fulfill(
      json([
        {
          id: "report-reported",
          enterpriseId: "enterprise-reported",
          enterprise: "Reported Heritage Park",
          category: "Park",
          barangay: "Landayan",
          month: MONTHS[previousMonth.getMonth()],
          period: previousPeriod,
          submitted: previousMonth.toISOString(),
          submittedAt: previousMonth.toISOString(),
          status: "Consolidated",
          code: "REP-1",
          attraction: { category: "Park", code: "P" },
          metrics: { entry: 1600, exit: 1500, unique: 1240, peak: "2:00 PM" },
        },
      ]),
    ),
  );
  await page.route("**/activity-logs**", (route) =>
    route.fulfill(
      json([
        {
          id: "log-1",
          timestamp: daysAgo(0).toISOString(),
          category: "Admin Operation",
          severity: "Success",
          actor: "LGU Admin",
          actorRole: "Admin",
          action: "Sign In",
          target: "",
          summary: "LGU Admin signed in to TANAW.",
        },
        {
          id: "log-2",
          timestamp: daysAgo(1).toISOString(),
          category: "IT Activity",
          severity: "Info",
          actor: "IT",
          actorRole: "IT Personnel",
          action: "Update Support Ticket Status",
          target: "",
          summary: "Request resolved: Desktop app closes on start-up.",
          resolutionStatus: "Resolved",
        },
        {
          id: "log-3",
          timestamp: daysAgo(2).toISOString(),
          category: "Admin Operation",
          severity: "Info",
          actor: "LGU Admin",
          actorRole: "Admin",
          action: "Update Enterprise Details",
          target: "",
          summary: "Updated details for San Antonio Plaza.",
        },
        {
          id: "log-4",
          timestamp: daysAgo(9).toISOString(),
          category: "System",
          severity: "Info",
          actor: "System",
          actorRole: "System",
          action: "Cleanup",
          target: "",
          summary: "An older record that is not shown.",
        },
      ]),
    ),
  );
  await page.route("**/operational/alerts", (route) =>
    route.fulfill(
      json([
        {
          id: "alert-1",
          type: "Maintenance Request",
          severity: "Warning",
          urgency: "Normal",
          enterprise: "San Antonio Plaza",
          requester: "San Antonio Plaza",
          summary: "Visitor counts stopped updating.",
          requiredAction: "",
          resolutionMode: "Remote Review",
          status: "New",
          owner: "IT",
          time: daysAgo(0).toISOString(),
        },
      ]),
    ),
  );
  await page.route("**/operational/tickets", (route) =>
    route.fulfill(
      json([
        {
          id: "ticket-1",
          code: "REQ-1",
          subject: "Entrance camera keeps disconnecting",
          enterpriseId: mapEnterprise.id,
          enterpriseName: mapEnterprise.name,
          category: "Camera",
          priority: "Normal",
          status: "In Review",
          description: "",
          submittedBy: "Front desk",
          attachments: [],
          createdAt: daysAgo(3).toISOString(),
          updatedAt: daysAgo(1).toISOString(),
        },
      ]),
    ),
  );
}

test("shows the map, Most Visited, Peak Occupancy and the recent lists from real data", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => window.localStorage.removeItem("tanaw-dashboard-busy-dismissed"));
  // Most Visited asks the server for one ranking instead of one visitor-insights request per enterprise.
  const rankingRequests: string[] = [];
  const enterpriseInsightRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/operational/visitor-insights/ranking")) rankingRequests.push(url.search);
    else if (url.pathname.endsWith("/operational/visitor-insights") && url.searchParams.has("enterpriseId")) enterpriseInsightRequests.push(url.search);
  });
  await openDashboard(page, { recent: true });

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Visitor activity and important updates across San Pedro.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "San Pedro, Laguna" })).toBeVisible();
  const mapDisplay = page.getByRole("group", { name: "Map display" });
  await expect(mapDisplay.getByRole("button", { name: "Boundaries" })).toHaveAttribute("aria-pressed", "true");
  await expect(mapDisplay.getByRole("button", { name: "Labels" })).toHaveAttribute("aria-pressed", "true");
  // The city view shows one pin per barangay: its busiest enterprise.
  await expect(page.locator("#admin-enterprise-map .leaflet-marker-icon")).toHaveCount(1);
  await expect(page.locator("#admin-enterprise-map .leaflet-marker-icon")).toHaveAttribute("aria-label", /^San Antonio Plaza, Barangay San Antonio\. Busiest in its barangay/);
  await expect(page.locator("#admin-enterprise-map .leaflet-marker-icon")).toHaveAttribute("data-pin-state", "ok");

  // Most Visited: this month from camera counts, ranked and linked to Enterprise Details.
  const mostVisited = page.getByRole("region", { name: "Most Visited" });
  await expect(mostVisited.getByText(/by visitors, from camera counts/)).toBeVisible();
  const ranked = mostVisited.getByRole("list", { name: "Most visited enterprises" }).getByRole("listitem");
  await expect(ranked).toHaveCount(2);
  await expect(ranked.first()).toContainText("San Antonio Plaza");
  await expect(ranked.nth(1)).toContainText(mapEnterprise.name);
  await expect(ranked.first().getByRole("link")).toHaveAttribute("href", `/admin/enterprises/${plaza.id}`);

  const rankBy = mostVisited.getByRole("radiogroup", { name: "Rank by" });
  await rankBy.getByRole("radio", { name: "Barangays" }).click();
  await expect(mostVisited.getByRole("list", { name: "Most visited barangays" }).getByRole("listitem")).toHaveCount(1);
  await expect(mostVisited.getByRole("list", { name: "Most visited barangays" })).toContainText("San Antonio");
  await rankBy.getByRole("radio", { name: "Enterprises" }).click();

  // A whole past month counts from monthly reports.
  await mostVisited.getByRole("button", { name: `${MONTHS[today.getMonth()]} ${today.getFullYear()}` }).click();
  const picker = page.getByRole("dialog", { name: "Choose a date range for Most Visited and Peak Occupancy" });
  await picker.getByRole("button", { name: "Previous month" }).click();
  await picker.getByRole("button", { name: "Apply" }).click();
  await expect(mostVisited.getByText(/by visitors, from monthly reports/)).toBeVisible();
  await expect(ranked.first()).toContainText("Reported Heritage Park");
  await expect(ranked.first()).toContainText("1.2K");

  // Peak Occupancy follows the same range: the last 7 days show one peak per day.
  await mostVisited.getByRole("button", { name: previousPeriod }).click();
  await picker.getByRole("button", { name: "Last 7 days" }).click();
  await picker.getByRole("button", { name: "Apply" }).click();
  const peak = page.getByRole("region", { name: "Peak Occupancy" });
  await expect(peak.getByText(/^Highest number inside each day, /)).toBeVisible();
  const yesterday = daysAgo(1);
  await expect(peak.getByText(`Peak 120 on ${MONTHS_SHORT[yesterday.getMonth()]} ${yesterday.getDate()}`)).toBeVisible();
  await expect(peak.locator(".recharts-area-curve")).toBeVisible();

  expect(rankingRequests.length).toBeGreaterThan(0);
  expect(enterpriseInsightRequests).toEqual([]);
  await peak.getByRole("button", { name: /^Place: All of San Pedro/ }).click();
  const places = page.getByRole("dialog", { name: "Choose where to show peak occupancy" });
  const search = places.getByRole("combobox");
  await expect(search).toBeFocused();
  await search.fill("zzz");
  await expect(places.getByText(/No enterprise or barangay matches/)).toBeVisible();
  await search.fill("plaza");
  await search.press("Enter");
  await expect(places).toHaveCount(0);
  await expect(peak.getByRole("button", { name: /^Place: San Antonio Plaza/ })).toBeFocused();
  await expect(peak.getByText(`Peak 52 on ${MONTHS_SHORT[yesterday.getMonth()]} ${yesterday.getDate()}`)).toBeVisible();

  // Recent Activity and Recent Requests show the newest three with links to their pages.
  const activity = page.getByRole("region", { name: "Recent Activity" });
  await expect(activity.getByRole("listitem")).toHaveCount(3);
  await expect(activity.getByRole("listitem").first()).toContainText("LGU Admin signed in to TANAW.");
  await expect(activity.getByRole("listitem").first()).toContainText("Login");
  await expect(activity.getByRole("link", { name: /Request resolved/ })).toHaveAttribute("href", "/admin/requests");
  await expect(activity.getByRole("link", { name: "View all activity" })).toHaveAttribute("href", "/admin/activity");
  const requests = page.getByRole("region", { name: "Recent Requests" });
  await expect(requests.getByRole("link", { name: /Maintenance request, San Antonio Plaza/ })).toHaveAttribute("href", "/admin/requests?alert=alert-1");
  await expect(requests.getByRole("link", { name: /Entrance camera keeps disconnecting/ })).toHaveAttribute("href", "/admin/requests?ticket=ticket-1");
  await expect(requests.getByText("Seen by IT")).toBeVisible();
  await expect(requests.getByText("In progress")).toBeVisible();
  await expect(requests.getByRole("link", { name: "View all requests" })).toHaveAttribute("href", "/admin/requests");

  await waitForStillPage(page);
  await page.screenshot({ path: testInfo.outputPath("admin-dashboard-light.png"), fullPage: true });

  await ranked.first().getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/admin/enterprises/${plaza.id}$`));
});

test("opens a barangay from its busiest pin and links the selected pin to Enterprise Details", async ({ page }) => {
  await openDashboard(page);
  const pins = page.locator("#admin-enterprise-map .leaflet-marker-icon");
  await pins.first().click();
  await expect(page.getByRole("button", { name: "All barangays" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Barangay San Antonio 2 enterprises" })).toBeVisible();
  await expect(pins).toHaveCount(2);
  const callout = page.getByRole("link", { name: "View details: San Antonio Plaza" });
  await expect(callout).toBeVisible();
  await expect(callout).toHaveAttribute("href", `/admin/enterprises/${plaza.id}`);

  // Another pin in the open barangay moves the callout without leaving the barangay. The two test pins
  // sit close together, so select it from the keyboard (pins are buttons) rather than by pointer.
  await page.locator(`#admin-enterprise-map .leaflet-marker-icon[aria-label^="${mapEnterprise.name}"]`).press("Enter");
  await expect(page.getByRole("link", { name: `View details: ${mapEnterprise.name}` })).toBeVisible();
  await expect(callout).toHaveCount(0);
  await expect(pins).toHaveCount(2);

  await page.getByRole("link", { name: `View details: ${mapEnterprise.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/enterprises/${mapEnterprise.id}$`));
  await page.goBack();
  await waitForMapReady(page);
  await expect(page.getByRole("heading", { name: "San Pedro, Laguna" })).toBeVisible();
});

test("shows, expands and dismisses the more-visitors-than-usual alert until the set changes", async ({ page }) => {
  let busy = [busyEntry(plaza.id, plaza.name, 41), busyEntry("enterprise-unpinned", "Riverside Market", 28)];
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("tanaw-e2e-busy-cleared")) {
      localStorage.removeItem("tanaw-dashboard-busy-dismissed");
      sessionStorage.setItem("tanaw-e2e-busy-cleared", "yes");
    }
  });
  await openDashboard(page, { busy: () => busy });

  const alert = page.locator(".tanaw-busy");
  await expect(alert).toHaveAttribute("role", "status");
  // Both monitored enterprises are busy, more than half, so the alert speaks for the whole city.
  await expect(alert).toContainText("Busier than usual across San Pedro");
  await expect(alert).toContainText("San Antonio Plaza and Riverside Market");
  await expect(page.locator("#admin-enterprise-map .leaflet-marker-icon .tanaw-enterprise-marker.is-busy")).toHaveCount(1);

  await alert.getByRole("button", { name: "View all" }).click();
  const panel = alert.getByRole("region", { name: "Busier than usual across San Pedro" });
  await expect(panel.getByRole("button", { name: "Hide" })).toBeFocused();
  await expect(panel.getByRole("link", { name: /View details: Riverside Market/ })).toHaveAttribute("href", "/admin/enterprises/enterprise-unpinned");
  await expect(panel).toContainText("Barangay San Antonio, not pinned on the map");
  const showPlaza = panel.getByRole("button", { name: /Show San Antonio Plaza on the map/ });
  await showPlaza.click();
  await expect(showPlaza).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "View details: San Antonio Plaza" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(alert.getByRole("button", { name: "View all" })).toBeFocused();

  await alert.getByRole("button", { name: "Dismiss these alerts until something changes" }).click();
  await expect(alert).toBeEmpty();
  await page.reload();
  await waitForMapReady(page);
  await expect(page.locator(".tanaw-busy")).toBeEmpty();

  busy = [busyEntry(plaza.id, plaza.name, 64)];
  await page.reload();
  await waitForMapReady(page);
  await expect(alert).toContainText("More visitors than usual");
  await expect(alert).toContainText("San Antonio Plaza, 64% above usual. 60 inside, usual for this hour is 43");
  await alert.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("link", { name: "View details: San Antonio Plaza" })).toBeVisible();
});

test("stacks into one column on narrow screens and reads well in dark mode", async ({ page }, testInfo) => {
  await openDashboard(page, { recent: true, theme: "dark", viewport: { width: 1000, height: 900 } });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const map = (await page.locator(".tanaw-dashboard-map").boundingBox())!;
  const mostVisited = (await page.getByRole("region", { name: "Most Visited" }).boundingBox())!;
  expect(mostVisited.y).toBeGreaterThan(map.y + map.height);
  expect(Math.abs(mostVisited.x - map.x)).toBeLessThan(2);
  await expect(page.locator(".tanaw-dashboard__insights")).toHaveCSS("border-left-width", "0px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await waitForStillPage(page);
  await page.screenshot({ path: testInfo.outputPath("admin-dashboard-dark-narrow.png"), fullPage: true });
});
