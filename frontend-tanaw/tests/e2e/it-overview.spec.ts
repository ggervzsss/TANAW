// IT Overview: greeting and figures, the four work lists, Start on it, Send again, Try again and empty states.
import { expect, test, type Page } from "@playwright/test";
import type { components } from "../../src/contracts/generated/api";
import { json, mockPortalSession, portalUser, type PortalTheme } from "./support/session";

type Schemas = components["schemas"];

// 2:30 PM on Nov 26, 2026 in Manila.
const NOW = new Date("2026-11-26T06:30:00Z");
const itUser = portalUser("it", { id: "it-ana", displayName: "Ana Reyes", firstName: "Ana", lastName: "Reyes" });

function request(id: string, overrides: Partial<Schemas["RequestSummary"]> = {}): Schemas["RequestSummary"] {
  return {
    id,
    code: `REQ-${id}`,
    group: "Desktop app or camera problem",
    title: `${id} title`,
    description: `${id} description`,
    status: "In Progress",
    enterpriseId: "riverside",
    enterpriseName: "Riverside Food Park",
    requesterName: "Front desk",
    requesterEmail: null,
    attachments: [],
    accountChange: null,
    unread: false,
    updated: false,
    seenByIt: false,
    handledBy: null,
    handledAt: null,
    createdAt: "2026-11-26T05:40:00Z",
    updatedAt: "2026-11-26T05:40:00Z",
    ...overrides,
  };
}

function place(enterpriseId: string, name: string, overrides: Partial<Schemas["EnterpriseHealthSummary"]> = {}): Schemas["EnterpriseHealthSummary"] {
  return {
    accountId: `acct-${enterpriseId}`,
    enterpriseId,
    name,
    barangay: "Poblacion",
    category: "Park",
    accountState: "active",
    app: { status: "online", lastDataAt: "2026-11-26T06:29:30Z", version: "0.1.3", latestVersion: "0.1.3", computerName: null },
    openNow: true,
    closedReason: null,
    cameras: { total: 2, counting: 2, list: [] },
    ...overrides,
  };
}

function account(id: string, overrides: Partial<Schemas["AccountSummary"]> = {}): Schemas["AccountSummary"] {
  return {
    id,
    email: `${id}@example.test`,
    phone: null,
    firstName: null,
    lastName: null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    enterpriseId: null,
    gatewayStatus: null,
    buildingCapacity: 0,
    displayName: id,
    role: "staff",
    title: "LGU Staff",
    status: "active",
    isActivated: true,
    isProtectedDefault: false,
    profileChangeRequests: [],
    createdAt: "2026-11-01T00:00:00Z",
    lastLoginAt: null,
    invitation: null,
    ...overrides,
  };
}

function delivery(id: string, overrides: Partial<Schemas["EmailDeliverySummary"]> = {}): Schemas["EmailDeliverySummary"] {
  return {
    id,
    purpose: "account_activation",
    recipient: `${id}@example.test`,
    provider: "brevo",
    status: "accepted",
    attemptCount: 1,
    maxAttempts: 5,
    manualRetryCount: 0,
    nextAttemptAt: null,
    providerMessageId: null,
    errorCode: null,
    failureReason: null,
    outcomeUncertain: false,
    canRetry: false,
    createdAt: "2026-11-25T08:05:00Z",
    acceptedAt: null,
    accountId: null,
    recipientName: null,
    recipientRole: null,
    ...overrides,
  };
}

const busyData = {
  requests: [
    request("000148", { title: "Entrance camera keeps disconnecting", enterpriseId: "balon", enterpriseName: "Balon ni Lolo Uweng" }),
    request("000147", { group: "Account change", title: "Change enterprise name", createdAt: "2026-11-26T03:20:00Z", enterpriseId: "balon", enterpriseName: "Balon ni Lolo Uweng" }),
    request("000145", { group: "Sign-in help", title: "Cannot sign in to the desktop app", handledBy: { accountId: "it-ana", name: "Ana Reyes" }, handledAt: "2026-11-26T01:00:00Z" }),
    request("000140", { title: "Handled by someone else", handledBy: { accountId: "it-carlo", name: "Carlo Mendoza" } }),
    request("000139", { title: "Already resolved", status: "Resolved" }),
  ],
  health: [
    place("riverside", "Riverside Food Park", {
      app: { status: "offline", lastDataAt: "2026-11-26T01:12:00Z" },
      cameras: {
        total: 2,
        counting: 0,
        list: [
          { id: "c1", name: "Entrance", status: "stopped", since: "2026-11-26T01:12:00Z", note: "Stopped with the desktop app." },
          { id: "c2", name: "Exit", status: "stopped", since: "2026-11-26T01:12:00Z", note: "Stopped with the desktop app." },
        ],
      },
    }),
    place("balon", "Balon ni Lolo Uweng", {
      cameras: {
        total: 2,
        counting: 1,
        list: [
          { id: "c3", name: "Entrance", status: "not_counting", note: "Disconnected 6 times today." },
          { id: "c4", name: "Exit", status: "counting" },
        ],
      },
    }),
    place("closed", "Closed Museum", { openNow: false, closedReason: "Closed today" }),
  ],
  lgu: [
    account("grace", { displayName: "Grace Bautista", isActivated: false, invitation: { sentAt: "2026-11-22T02:00:00Z", expiresAt: "2026-11-29T02:00:00Z", expired: false } }),
    account("carlo", {
      displayName: "Carlo Mendoza",
      role: "it",
      title: "IT Personnel",
      profileChangeRequests: [
        { type: "businessEmail", label: "Email", requestedValue: "carlo@new.example", requestedAt: null, requestId: "ec-1", status: "verified", isVerified: true, canApprove: false, expiresAt: null },
      ],
    }),
  ],
  enterprises: [
    account("museum", {
      role: "enterprise",
      title: "Enterprise Account",
      enterpriseName: "San Pedro Heritage Museum",
      isActivated: false,
      invitation: { sentAt: "2026-11-18T02:00:00Z", expiresAt: "2026-11-25T02:00:00Z", expired: true },
    }),
  ],
  emails: [
    delivery("ok"),
    delivery("mail-1", {
      status: "terminal_failed",
      canRetry: true,
      recipient: "museum@example.test",
      failureReason: "the mailbox is full",
      recipientName: "San Pedro Heritage Museum",
      recipientRole: "Enterprise Account",
    }),
  ],
};

type OverviewData = typeof busyData;

async function openOverview(page: Page, data: OverviewData = busyData, options: { theme?: PortalTheme; viewport?: { width: number; height: number } } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 1000 });
  await mockPortalSession(page, itUser, { theme: options.theme });
  const calls: string[] = [];
  let requests = [...data.requests];
  for (const endpoint of ["**/operational/notifications", "**/operational/alerts", "**/activity-logs"]) {
    await page.route(endpoint, (route) => route.fulfill(json([])));
  }
  await page.route("**/operational/requests", (route) => route.fulfill(json(requests)));
  await page.route(/\/operational\/requests\/[^/]+\/start$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    calls.push(`start ${id}`);
    requests = requests.map((item) => (item.id === id ? { ...item, handledBy: { accountId: itUser.id, name: itUser.displayName }, handledAt: NOW.toISOString() } : item));
    return route.fulfill(json({ ...requests.find((item) => item.id === id), messages: [] }));
  });
  await page.route("**/operational/enterprise-health", (route) => route.fulfill(json(data.health)));
  await page.route("**/accounts/lgu", (route) => route.fulfill(json(data.lgu)));
  await page.route("**/accounts/enterprises", (route) => route.fulfill(json(data.enterprises)));
  await page.route(/\/accounts\/[^/]+\/activation$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    calls.push(`resend ${id}`);
    return route.fulfill(json([...data.lgu, ...data.enterprises].find((item) => item.id === id)));
  });
  await page.route(/\/mail\/deliveries(\?.*)?$/, (route) => {
    calls.push(`emails ${new URL(route.request().url()).searchParams.get("sinceDays")}`);
    return route.fulfill(json(data.emails));
  });
  await page.route(/\/mail\/deliveries\/[^/]+\/retry$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    calls.push(`retry ${id}`);
    return route.fulfill(json({ ...data.emails.find((item) => item.id === id), status: "queued", canRetry: false }));
  });
  await page.goto("/it/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Good afternoon, Ana" })).toBeVisible();
  return calls;
}

test("shows the greeting, the four figures and what needs IT in each list", async ({ page }) => {
  const calls = await openOverview(page);

  await expect(page.getByRole("status").filter({ hasText: "Connections are live." })).toBeVisible();
  const figures = page.getByRole("definition");
  await expect(figures.nth(0)).toContainText("2");
  await expect(figures.nth(0)).toContainText("4 open requests in total, 1 with you");
  await expect(figures.nth(1)).toContainText("1 desktop app offline");
  await expect(figures.nth(2)).toContainText("3");
  await expect(figures.nth(2)).toContainText("Of 4 cameras at 2 places");
  await expect(figures.nth(3)).toContainText("3");
  await expect(figures.nth(3)).toContainText("2 invitations not accepted and an email change to approve");

  const requests = page.getByTestId("it-overview-requests");
  await expect(requests.getByRole("link", { name: "All requests" })).toHaveAttribute("href", "/it/requests");
  await expect(requests.getByRole("listitem")).toHaveCount(3);
  await expect(requests.getByRole("listitem").nth(0)).toContainText("Not picked up yet");
  await expect(requests.getByRole("link", { name: "Entrance camera keeps disconnecting" })).toHaveAttribute("href", "/it/requests?request=000148");
  // Each row opens as a whole; only "Start on it" stays a button.
  const req145 = requests.getByRole("listitem").filter({ hasText: "REQ-000145" });
  await expect(req145.getByRole("link")).toHaveAttribute("href", "/it/requests?request=000145");
  await expect(req145.getByRole("link", { name: /^Open/ })).toHaveCount(0);
  await expect(requests).not.toContainText("Handled by someone else");
  await expect(requests).not.toContainText("Already resolved");

  const connections = page.getByTestId("it-overview-connections");
  await expect(connections.getByRole("listitem")).toHaveCount(2);
  await expect(connections.getByRole("listitem").nth(0)).toContainText("Desktop app offline");
  await expect(connections.getByRole("listitem").nth(0)).toContainText("No data since 9:12 AM. Both cameras stopped counting with it.");
  await expect(connections.getByRole("listitem").nth(1)).toContainText("1 camera not counting");
  await expect(connections.getByRole("listitem").nth(1)).toContainText("Request REQ-000148 is open");
  await expect(connections.getByRole("link", { name: "Riverside Food Park" })).toHaveAttribute("href", "/it/enterprises/riverside");
  await expect(connections.getByRole("link", { name: /^Check/ })).toHaveCount(0);
  await expect(connections).not.toContainText("Closed Museum");

  const accounts = page.getByTestId("it-overview-accounts");
  await expect(accounts.getByRole("button", { name: "Send again to Grace Bautista" })).toBeVisible();
  await expect(accounts.getByRole("button", { name: "Send a new link to San Pedro Heritage Museum" })).toBeVisible();
  await expect(accounts.getByRole("link", { name: "Review the email change for Carlo Mendoza, IT" })).toHaveAttribute("href", "/it/personnel");
  await expect(accounts).toContainText("Another IT account has to approve it.");

  const emails = page.getByTestId("it-overview-emails");
  await expect(emails.getByRole("link", { name: "Email log" })).toHaveAttribute("href", "/it/system?tab=email");
  await expect(emails.getByRole("listitem")).toHaveCount(1);
  await expect(emails).toContainText("Enterprise invitation");
  await expect(emails).toContainText("Not delivered: the mailbox is full.");
  expect(calls).toContain("emails 7");
});

test("starts on a request right away and says so", async ({ page }) => {
  const calls = await openOverview(page);
  const requests = page.getByTestId("it-overview-requests");

  await requests.getByRole("button", { name: "Start on it (REQ-000148)" }).click();
  await expect(page.getByText("You are on REQ-000148")).toBeVisible();
  await expect(requests.getByText("You started on it just now")).toBeVisible();
  await expect(requests.getByRole("button", { name: "Start on it (REQ-000148)" })).toHaveCount(0);
  await expect(requests.getByRole("link", { name: "Entrance camera keeps disconnecting" })).toBeVisible();
  await expect(page.getByRole("definition").nth(0)).toContainText("4 open requests in total, 2 with you");
  expect(calls).toContain("start 000148");
});

test("sends an invitation again and tries a failed email again", async ({ page }) => {
  const calls = await openOverview(page);

  const accounts = page.getByTestId("it-overview-accounts");
  await accounts.getByRole("button", { name: "Send a new link to San Pedro Heritage Museum" }).click();
  await expect(page.getByText("Invitation sent again")).toBeVisible();
  await expect(accounts.getByText("Sent again", { exact: true })).toBeVisible();
  expect(calls).toContain("resend museum");

  const emails = page.getByTestId("it-overview-emails");
  await emails.getByRole("button", { name: "Try again for San Pedro Heritage Museum" }).click();
  await expect(page.getByText("Trying again", { exact: true })).toBeVisible();
  await expect(emails).toContainText("Sent again just now. Waiting for the mail server.");
  await expect(emails.getByRole("button", { name: /Try again/ })).toHaveCount(0);
  expect(calls).toContain("retry mail-1");
});

test("says when nothing is waiting, in dark mode and at phone width", async ({ page }) => {
  await openOverview(page, { requests: [], health: [place("fine", "Fine Park")], lgu: [], enterprises: [], emails: [delivery("ok")] }, { theme: "dark", viewport: { width: 390, height: 844 } });

  await expect(page.getByText("No requests are waiting for IT.")).toBeVisible();
  await expect(page.getByText("Every open place is sending data and every camera is counting.")).toBeVisible();
  await expect(page.getByText("Every account is activated, and no email change is waiting.")).toBeVisible();
  await expect(page.getByText("Every email in the last 7 days was delivered.")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
