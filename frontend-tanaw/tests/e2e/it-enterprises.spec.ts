// IT Enterprises and Manage an enterprise: the list with its figures, chips and invitation actions,
// the Register enterprise dialog, and the Connection, Details and account, and Opening hours tabs.
import { expect, test, type Page, type Route } from "@playwright/test";
import { json, mockPortalSession, portalUser } from "./support/session";

// 3:51 PM on Nov 26, 2026 in Manila.
const NOW = new Date("2026-11-26T07:51:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

type Json = Record<string, unknown>;

const attraction = { code: "401", typeCode: "4", type: "Sports and Recreational Facilities", category: "Golf", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD404" };
const hours = { days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({ day, mode: "hours", periods: [{ open: "06:00", close: "18:00" }] })) };

function account(id: string, name: string, overrides: Json = {}): Json {
  return {
    id,
    email: `${id}@example.test`,
    phone: "+639171110003",
    firstName: null,
    lastName: null,
    enterpriseName: name,
    category: "Golf",
    attraction,
    attractionDescription: null,
    managerName: "Nora Dizon",
    barangay: "San Antonio",
    address: "Mahogany Street",
    latitude: 14.353372,
    longitude: 121.030528,
    locationUpdatedAt: "2026-07-21T13:00:00Z",
    enterpriseId: `ENT-${id}`,
    gatewayStatus: null,
    buildingCapacity: 250,
    openingHours: hours,
    displayName: name,
    role: "enterprise",
    title: "Enterprise Account",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2026-03-03T00:00:00Z",
    lastLoginAt: "2026-11-26T00:58:00Z",
    invitation: null,
    deactivatedAt: null,
    deactivatedByName: null,
    ...overrides,
  };
}

function health(accountId: string, name: string, overrides: Json = {}, app: Json = {}, cameras: Json = {}): Json {
  return {
    accountId,
    enterpriseId: `ENT-${accountId}`,
    name,
    barangay: "San Antonio",
    category: "Golf",
    accountState: "active",
    app: { status: "online", lastDataAt: minutesAgo(1), version: "0.1.2", latestVersion: "0.1.3", computerName: "Park office computer", ...app },
    openNow: true,
    closedReason: null,
    cameras: { total: 2, counting: 2, list: [], ...cameras },
    ...overrides,
  };
}

function fixtures() {
  const accounts = [
    account("lakeside", "Lakeside Park"),
    account("sports", "Municipal Sports Center"),
    account("cuyab", "Cuyab River Eco Park", { isActivated: false, invitation: { sentAt: daysAgo(3), expiresAt: daysAgo(2), expired: false }, lastLoginAt: null }),
    account("museum", "Heritage Museum", { isActivated: false, invitation: { sentAt: daysAgo(4), expiresAt: daysAgo(1), expired: true }, lastLoginAt: null }),
  ];
  const healthList = [
    health(
      "lakeside",
      "Lakeside Park",
      {},
      {},
      {
        total: 4,
        counting: 3,
        list: [
          { id: "cam-a", name: "Gate A", mode: "entrance_exit", brand: "Hikvision", status: "not_counting", since: "2026-11-26T07:24:00Z", note: "Gate A keeps losing its picture" },
          { id: "cam-b", name: "Gate B", mode: "entrance_exit", brand: "Dahua", status: "counting", since: null, note: null },
        ],
      },
    ),
    health("sports", "Municipal Sports Center"),
    health("cuyab", "Cuyab River Eco Park", { accountState: "invited" }, { status: "not_set_up", lastDataAt: null, version: null, computerName: null }, { total: 0, counting: 0 }),
    health("museum", "Heritage Museum", { accountState: "expired" }, { status: "not_set_up", lastDataAt: null, version: null, computerName: null }, { total: 0, counting: 0 }),
  ];
  return { accounts, healthList };
}

const today = {
  date: "2026-11-26",
  openFrom: "06:00",
  openTo: "18:00",
  hours: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  cameras: [
    {
      id: "cam-a",
      name: "Gate A",
      mode: "entrance_exit",
      brand: "Hikvision",
      dropCount: 9,
      note: "Dropped out 9 times since 12 PM.",
      slots: "oooooogggdff".split("").map((code, index) => ({ hour: 6 + index, state: { o: "counting", g: "gaps", d: "down", f: "future" }[code] })),
    },
    {
      id: "cam-b",
      name: "Gate B",
      mode: "entrance_exit",
      brand: "Dahua",
      dropCount: 0,
      note: "No problems today.",
      slots: "ooooooooooff".split("").map((code, index) => ({ hour: 6 + index, state: code === "o" ? "counting" : "future" })),
    },
  ],
};

const requests = [
  {
    id: "request-1",
    code: "REQ-000149",
    group: "Desktop app or camera problem",
    title: "Gate A camera keeps losing its picture",
    description: "The picture drops every few minutes.",
    status: "In Progress",
    enterpriseId: "ENT-lakeside",
    enterpriseName: "Lakeside Park",
    requesterName: "Nora Dizon",
    requesterEmail: null,
    affectedArea: null,
    camera: "Gate A",
    attachments: [],
    accountChange: null,
    closedAt: null,
    handledBy: { accountId: "it-2", name: "Carlo Mendoza" },
    handledAt: "2026-11-26T07:35:00Z",
    createdAt: "2026-11-26T07:30:00Z",
    updatedAt: "2026-11-26T07:35:00Z",
    unread: false,
    updated: false,
  },
];

type Api = { posts: { path: string; body: unknown }[]; patches: { path: string; body: unknown }[]; deletes: string[] };

async function openIt(page: Page, path: string, options: { passwordReset?: "ok" | "wait" } = {}) {
  await page.clock.setFixedTime(NOW);
  await mockPortalSession(page, portalUser("it"));
  const { accounts, healthList } = fixtures();
  const closures: Json[] = [{ id: "closure-1", startDate: "2026-12-25", endDate: "2026-12-25", reason: "Christmas Day", createdBy: "IT Personnel" }];
  const api: Api = { posts: [], patches: [], deletes: [] };
  const record = (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() : null;
    if (request.method() === "POST") api.posts.push({ path, body });
    if (request.method() === "PATCH") api.patches.push({ path, body });
    if (request.method() === "DELETE") api.deletes.push(path);
    return { path, body: body as Json | null, method: request.method() };
  };
  const find = (reference: string) => accounts.find((item) => item.id === reference || item.enterpriseId === reference);

  await page.route("**/operational/notifications**", (route) => route.fulfill(json([])));
  await page.route("**/activity-logs**", (route) => route.fulfill(json([])));
  await page.route(/\/operational\/requests(\?.*)?$/, (route) => route.fulfill(json(requests)));
  await page.route("**/operational/notifications/enterprise", (route) => {
    record(route);
    return route.fulfill(json({ id: "notice-1" }, 201));
  });
  await page.route(/\/operational\/enterprise-health(\/[^/?]+)?(\/today)?(\?.*)?$/, (route) => {
    const parts = new URL(route.request().url()).pathname.split("/").filter(Boolean);
    const index = parts.indexOf("enterprise-health");
    const reference = parts[index + 1] ? decodeURIComponent(parts[index + 1]) : null;
    if (!reference) return route.fulfill(json(healthList));
    const item = healthList.find((entry) => entry.enterpriseId === reference || entry.accountId === reference);
    if (!item) return route.fulfill(json({ detail: "Enterprise not found." }, 404));
    return route.fulfill(json(parts[index + 2] === "today" ? today : item));
  });
  await page.route(/\/accounts\/enterprises(\?.*)?$/, (route) => {
    const { method, body } = record(route);
    if (method === "POST") return route.fulfill(json(account("new", String(body?.enterpriseName), { email: body?.email, isActivated: false }), 201));
    return route.fulfill(json(accounts));
  });
  await page.route(/\/accounts\/enterprises\/location-suggestions/, (route) =>
    route.fulfill(
      json([
        {
          placeId: "place-1",
          name: "Mahogany Street",
          formattedAddress: "Mahogany Street, San Antonio, San Pedro, Laguna",
          addressLine: "Mahogany Street",
          barangay: "San Antonio",
          latitude: 14.353372,
          longitude: 121.030528,
        },
      ]),
    ),
  );
  await page.route(/\/accounts\/enterprises\/[^/?]+\/closures(\/[^/?]+)?$/, (route) => {
    const { method, body, path } = record(route);
    if (method === "POST") {
      const created = { id: "closure-2", startDate: body?.startDate, endDate: body?.endDate, reason: body?.reason ?? null, createdBy: "IT Personnel" };
      closures.push(created);
      return route.fulfill(json(created, 201));
    }
    if (method === "DELETE") {
      const id = path.split("/").pop();
      closures.splice(
        closures.findIndex((item) => item.id === id),
        1,
      );
      return route.fulfill({ status: 204 });
    }
    return route.fulfill(json(closures));
  });
  await page.route(/\/accounts\/enterprises\/[^/?]+$/, (route) => {
    if (route.request().url().includes("location-suggestions")) return route.fallback();
    const { method, body, path } = record(route);
    const item = find(decodeURIComponent(path.split("/").pop() ?? ""));
    if (!item) return route.fulfill(json({ detail: "Enterprise account not found." }, 404));
    if (method === "PATCH") Object.assign(item, body, body?.openingHours ? {} : { openingHours: item.openingHours });
    return route.fulfill(json(item));
  });
  await page.route(/\/accounts\/[^/]+\/(activation|status|password-reset)$/, (route) => {
    const { path, body } = record(route);
    const [, , id, action] = path.split("/");
    const item = find(id);
    if (!item) return route.fulfill(json({ detail: "Account not found." }, 404));
    if (action === "activation") return route.fulfill(json({ ...item, invitation: { sentAt: NOW.toISOString(), expiresAt: daysAgo(-1), expired: false } }));
    if (action === "status") {
      Object.assign(item, { status: body?.status, deactivatedAt: body?.status === "inactive" ? NOW.toISOString() : null, deactivatedByName: body?.status === "inactive" ? "IT Personnel" : null });
      return route.fulfill(json(item));
    }
    if (options.passwordReset === "wait")
      return route.fulfill(json({ detail: { message: "A password reset code was sent to this account moments ago. Please wait before sending another.", retryAfterSeconds: 45 } }, 429));
    return route.fulfill(json({ sentTo: item.email }, 202));
  });

  await page.goto(path);
  return api;
}

test.describe("IT Enterprises list", () => {
  test("shows the figures, chips and each enterprise's account, app and cameras", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openIt(page, "/it/enterprises");

    await expect(page.getByRole("heading", { level: 1, name: "Enterprises" })).toBeVisible();
    const figures = page.locator("dl").first();
    await expect(figures).toContainText("Registered enterprises");
    await expect(figures).toContainText("2 active, 2 waiting for the owner to sign in");
    await expect(figures).toContainText("Desktop apps sending data");
    await expect(figures).toContainText("2 of 2");
    await expect(figures).toContainText("All sending data");
    await expect(figures).toContainText("5 of 6");
    await expect(figures).toContainText("1 not counting at 1 place");

    const chips = page.getByRole("group", { name: "Show" });
    await expect(chips.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    await expect(chips.getByRole("button", { name: "Needs attention 1" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "Invitation pending 2" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "Sending data 1" })).toBeVisible();

    const lakeside = page.getByRole("row", { name: /Lakeside Park/ });
    await expect(lakeside).toContainText("Golf · Brgy. San Antonio");
    await expect(lakeside).toContainText("Active");
    await expect(lakeside).toContainText("Online");
    await expect(lakeside).toContainText("Last data 1 min ago");
    await expect(lakeside).toContainText("3 of 4 counting");
    await expect(lakeside).toContainText("Gate A keeps losing its picture");
    await expect(lakeside.getByRole("link", { name: "Manage Lakeside Park" })).toHaveAttribute("href", "/it/enterprises/ENT-lakeside");

    const cuyab = page.getByRole("row", { name: /Cuyab River Eco Park/ });
    await expect(cuyab).toContainText("Invitation sent");
    await expect(cuyab).toContainText("3 days ago, not accepted yet");
    await expect(cuyab).toContainText("Not set up yet");
    await expect(page.getByRole("row", { name: /Heritage Museum/ })).toContainText("Invitation expired");
  });

  test("filters by chip and search, and sends an invitation again", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const api = await openIt(page, "/it/enterprises");

    await page.getByRole("button", { name: "Show places that need attention" }).click();
    await expect(page).toHaveURL(/show=attention/);
    await expect(page.getByRole("group", { name: "Show" }).getByRole("button", { name: /Needs attention/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("tbody tr")).toHaveCount(1);

    await page
      .getByRole("group", { name: "Show" })
      .getByRole("button", { name: /Invitation pending/ })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "Send a new link to Heritage Museum" }).click();
    await expect.poll(() => api.posts.map((post) => post.path)).toContain("/accounts/museum/activation");
    await expect(page.getByText("A new sign-in link went to museum@example.test.")).toBeVisible();

    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
    await page.getByRole("searchbox", { name: "Search enterprises" }).fill("sports@example");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("Municipal Sports Center");
    await page.getByRole("searchbox", { name: "Search enterprises" }).fill("nowhere");
    await expect(page.getByText("No enterprises match.")).toBeVisible();
    await page.getByRole("button", { name: "Show all enterprises" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
  });

  test("registers an enterprise from the Register enterprise dialog", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const api = await openIt(page, "/it/enterprises");

    await page.getByRole("button", { name: "Register enterprise" }).click();
    await expect(page).toHaveURL(/register=1/);
    const sheet = page.getByRole("dialog", { name: "Register enterprise" });
    await expect(sheet).toBeVisible();

    // Missing fields: the first one gets focus.
    await sheet.getByRole("button", { name: "Register and send invitation" }).click();
    await expect(sheet.getByText("Enterprise name is required.")).toBeVisible();
    await expect(sheet.getByLabel("Enterprise name")).toBeFocused();

    await sheet.getByLabel("Enterprise name").fill("Cuyab Riverside Park");
    await sheet.getByRole("combobox", { name: "Attraction type" }).click();
    await page.getByRole("option", { name: /^Golf/ }).click();
    await sheet.getByRole("combobox", { name: "Search for a place or address" }).fill("Mahogany");
    await page.getByRole("option", { name: /Mahogany Street/ }).click();
    await expect(sheet.getByText(/Pin set in Brgy\. San Antonio/)).toBeVisible();
    await expect(sheet.getByLabel("Block, lot and street")).toHaveValue("Mahogany Street");
    await sheet.getByLabel("First name").fill("Rosa");
    await sheet.getByLabel("Last name").fill("Dizon");
    await sheet.getByLabel("Owner email").fill("rosa@example.test");
    await sheet.getByRole("button", { name: "Register and send invitation" }).click();

    await expect
      .poll(() => api.posts.find((post) => post.path === "/accounts/enterprises")?.body)
      .toMatchObject({
        enterpriseName: "Cuyab Riverside Park",
        attractionCode: "401",
        barangay: "San Antonio",
        address: "Mahogany Street",
        managerName: "Rosa Dizon",
        email: "rosa@example.test",
        buildingCapacity: 100,
      });
    await expect(page.getByText("Enterprise registered")).toBeVisible();
    await expect(page.getByText("The invitation went to rosa@example.test.")).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/register=1/);
  });

  test("closes the dialog with Escape", async ({ page }) => {
    await openIt(page, "/it/enterprises?register=1");
    const sheet = page.getByRole("dialog", { name: "Register enterprise" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/register=1/);
  });
});

test.describe("Manage an enterprise", () => {
  test("Connection shows the app, today's cameras and requests, and sends a notice", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    const api = await openIt(page, "/it/enterprises/ENT-lakeside");

    await expect(page.getByRole("link", { name: "Back to Enterprises" })).toHaveAttribute("href", "/it/enterprises");
    await expect(page.getByRole("heading", { level: 1, name: "Lakeside Park" })).toBeVisible();
    await expect(page.getByText("Golf · Brgy. San Antonio · Registered Mar 3, 2026")).toBeVisible();
    await expect(page.getByText("1 of 4 cameras not counting")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Connection" })).toHaveAttribute("aria-selected", "true");

    const panel = page.getByRole("tabpanel");
    await expect(panel).toContainText("Desktop app status");
    await expect(panel).toContainText("1 min ago, 3:50 PM");
    await expect(panel).toContainText("0.1.2 (update available)");
    await expect(panel).toContainText("Park office computer");

    await expect(panel.getByText("Each block is one hour, 6 AM to 6 PM. The place is open 6 AM to 6 PM today.")).toBeVisible();
    for (const label of ["Counting", "Dropped out at times", "Not counting", "Closed", "Not yet"]) await expect(panel.getByRole("list", { name: "Legend" })).toContainText(label);
    await expect(panel.getByRole("img", { name: /^Gate A: counting 6 AM to 12 PM, dropping out at times 12 PM to 3 PM, not counting 3 PM to 4 PM/ })).toBeVisible();
    await expect(panel.getByRole("img", { name: "Gate B: counting 6 AM to 4 PM, not yet 4 PM to 6 PM." })).toBeVisible();
    await expect(panel).toContainText("Not counting since 3:24 PM");
    await expect(panel).toContainText("Entry and exit · Hikvision");
    await expect(panel).toContainText("Dropped out 9 times since 12 PM.");

    await expect(panel.getByRole("link", { name: "Gate A camera keeps losing its picture" })).toHaveAttribute("href", "/it/requests?request=request-1");
    await expect(panel).toContainText("In progress · Carlo Mendoza");

    await panel.getByRole("button", { name: "Send to Lakeside Park" }).click();
    await expect(panel.getByText("Add a short title.")).toBeVisible();
    await panel.getByLabel("Title").fill("Check the Gate A cable");
    await panel.getByLabel("Message").fill("Please push the Gate A network cable in all the way.");
    await panel.getByRole("button", { name: "Send to Lakeside Park" }).click();
    await expect
      .poll(() => api.posts.find((post) => post.path === "/operational/notifications/enterprise")?.body)
      .toEqual({
        enterpriseId: "ENT-lakeside",
        title: "Check the Gate A cable",
        message: "Please push the Gate A network cable in all the way.",
      });
    await expect(page.getByText("Notice sent")).toBeVisible();
  });

  test("Details and account saves details, waits out a password reset limit, and deactivates", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    const api = await openIt(page, "/it/enterprises/ENT-lakeside?tab=details", { passwordReset: "wait" });

    await expect(page.getByRole("tab", { name: "Details and account" })).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByLabel("Enterprise name")).toHaveValue("Lakeside Park");
    await expect(panel.getByText("lakeside@example.test")).toBeVisible();
    await expect(panel.getByText("Active, can sign in")).toBeVisible();
    await expect(panel.getByText(/approve it in Requests/)).toBeVisible();
    // An activated owner's email changes only through a request.
    await expect(panel.getByLabel("Owner email")).toHaveCount(0);

    await panel.getByLabel("Capacity (people)").fill("300");
    await panel.getByRole("button", { name: "Save details" }).click();
    const review = page.getByRole("dialog", { name: "Save these changes?" });
    await expect(review).toContainText("Building capacity: 250 → 300");
    await review.getByRole("button", { name: "Save details" }).click();
    await expect.poll(() => api.patches.find((patch) => patch.path === "/accounts/enterprises/lakeside")?.body).toMatchObject({ buildingCapacity: 300, email: "lakeside@example.test" });
    expect((api.patches.find((patch) => patch.path === "/accounts/enterprises/lakeside")?.body as Json).openingHours).toBeUndefined();
    await expect(page.getByText("Details saved")).toBeVisible();

    await panel.getByRole("button", { name: "Send a password reset email" }).click();
    await expect(panel.getByText(/moments ago/)).toBeVisible();
    await expect(panel.getByRole("button", { name: /Send again in \d+ s/ })).toBeDisabled();

    await panel.getByRole("button", { name: "Deactivate enterprise" }).click();
    const confirm = page.getByRole("dialog", { name: "Deactivate this enterprise?" });
    await expect(confirm).toContainText("Past reports stay.");
    await confirm.getByRole("button", { name: "Deactivate enterprise" }).click();
    await expect.poll(() => api.patches.find((patch) => patch.path === "/accounts/lakeside/status")?.body).toEqual({ status: "inactive" });
    await expect(page.getByText("Enterprise deactivated")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Activate enterprise" })).toBeVisible();
  });

  test("Details and account sends an invitation again for an owner who has not signed in", async ({ page }) => {
    const api = await openIt(page, "/it/enterprises/ENT-cuyab?tab=details");
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("Invitation sent, not accepted yet")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Send a password reset email" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Send invitation again" }).click();
    await expect.poll(() => api.posts.map((post) => post.path)).toContain("/accounts/cuyab/activation");
  });

  test("Opening hours saves the week and adds and removes closed days", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    const api = await openIt(page, "/it/enterprises/ENT-lakeside?tab=hours");
    const panel = page.getByRole("tabpanel");

    await panel.getByLabel("Sunday hours").selectOption("closed");
    await panel.getByRole("button", { name: "Save hours" }).click();
    await expect
      .poll(() => (api.patches.find((patch) => patch.path === "/accounts/enterprises/lakeside")?.body as Json | undefined)?.openingHours)
      .toMatchObject({
        days: expect.arrayContaining([{ day: "sunday", mode: "closed", periods: [] }]),
      });
    await expect(page.getByText("Hours saved")).toBeVisible();

    await expect(panel.getByText("Dec 25, 2026")).toBeVisible();
    await expect(panel.getByText("Christmas Day")).toBeVisible();
    await panel.getByLabel("Date", { exact: true }).fill("2027-01-12");
    await panel.getByLabel("Reason (optional)").fill("Pond cleaning");
    await panel.getByRole("button", { name: "Add closed day" }).click();
    await expect.poll(() => api.posts.find((post) => post.path.endsWith("/closures"))?.body).toEqual({ startDate: "2027-01-12", endDate: "2027-01-12", reason: "Pond cleaning" });
    await expect(panel.getByText("Pond cleaning")).toBeVisible();

    await panel.getByRole("button", { name: "Remove closed day Dec 25, 2026" }).click();
    await expect.poll(() => api.deletes).toContain("/accounts/enterprises/lakeside/closures/closure-1");
    await expect(panel.getByText("Christmas Day")).toBeHidden();
  });

  test("an unknown enterprise shows a not-found state with a way back", async ({ page }) => {
    await openIt(page, "/it/enterprises/ENT-missing");
    await expect(page.getByText("This enterprise is not registered")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Enterprises" })).toHaveAttribute("href", "/it/enterprises");
  });

  test("works at phone width in dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
    await openIt(page, "/it/enterprises/ENT-lakeside");
    await expect(page.getByRole("heading", { level: 1, name: "Lakeside Park" })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
