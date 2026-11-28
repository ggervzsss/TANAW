// IT Requests: the table with its filters in the address, Start on it from a row, the request
// beside a narrower table (and closing it), the page fitting the window with only the table and
// the request scrolling, IT's actions (start, resolve, approve or decline a change, reopen, move),
// replies and the phone layout.
import { expect, test, type Page, type Route } from "@playwright/test";
import { json, mockPortalSession, portalUser } from "./support/session";

// 4:00 PM on Nov 23, 2026 in Manila.
const NOW = new Date("2026-11-23T08:00:00Z");
const ME = { accountId: "it-e2e", name: "IT Personnel" };
const CARLO = { accountId: "it-carlo", name: "Carlo Mendoza" };

type RequestRecord = Record<string, unknown> & { id: string; code: string; status: string; group: string; handledBy: { accountId: string; name: string } | null };
type Message = { id: string; requestId: string; authorId: string; authorName: string; authorRole: string; kind: string; message: string; createdAt: string };

const base = {
  enterpriseId: "ENT-1",
  enterpriseName: "Balon ni Lolo Uweng",
  requesterName: "Jose Ramos",
  requesterEmail: null,
  affectedArea: null,
  camera: null,
  attachments: [],
  accountChange: null,
  handledBy: null,
  handledAt: null,
  closedAt: null,
  unread: false,
  updated: false,
};

function requestsFixture(): RequestRecord[] {
  return [
    {
      ...base,
      id: "req-gate",
      code: "REQ-000149",
      group: "Desktop app or camera problem",
      title: "Gate A camera keeps losing its picture",
      description: "The Gate A camera picture freezes every few minutes.",
      status: "In Progress",
      enterpriseName: "San Antonio Lakeside Park",
      enterpriseId: "ENT-2",
      requesterName: "Nora Dizon",
      affectedArea: "Gate A",
      camera: "Main entrance",
      handledBy: CARLO,
      handledAt: "2026-11-23T07:40:00Z",
      createdAt: "2026-11-23T07:30:00Z",
      updatedAt: "2026-11-23T07:45:00Z",
    },
    {
      ...base,
      id: "req-entrance",
      code: "REQ-000148",
      group: "Desktop app or camera problem",
      title: "Entrance camera keeps disconnecting",
      description: "The Entrance camera drops off every few minutes.",
      status: "In Progress",
      camera: "Entrance",
      createdAt: "2026-11-23T05:40:00Z",
      updatedAt: "2026-11-23T05:40:00Z",
    },
    {
      ...base,
      id: "req-name",
      code: "REQ-000147",
      group: "Account change",
      title: "Change of enterprise name",
      description: "Balon ni Lolo Uweng asked to change its enterprise name.",
      status: "In Progress",
      accountChange: {
        field: "enterpriseName",
        label: "Enterprise name",
        currentValue: "Balon ni Lolo Uweng",
        requestedValue: "Balon ni Lolo Uweng Heritage Site",
        verification: null,
        canApprove: true,
      },
      createdAt: "2026-11-23T03:20:00Z",
      updatedAt: "2026-11-23T03:20:00Z",
    },
    {
      ...base,
      id: "req-email",
      code: "REQ-000146",
      group: "Account change",
      title: "Change of business email",
      description: "Balon ni Lolo Uweng asked to change its business email.",
      status: "In Progress",
      accountChange: {
        field: "businessEmail",
        label: "Business email",
        currentValue: "info@balon.example",
        requestedValue: "office@balon.example",
        verification: "pending_verification",
        canApprove: false,
      },
      createdAt: "2026-11-22T06:00:00Z",
      updatedAt: "2026-11-22T06:00:00Z",
    },
    {
      ...base,
      id: "req-report",
      code: "REQ-000144",
      group: "Report problem",
      title: "Correct the September visitor total",
      description: "A school tour was counted twice.",
      status: "Resolved",
      handledBy: ME,
      handledAt: "2026-11-21T09:02:00Z",
      closedAt: "2026-11-21T09:30:00Z",
      createdAt: "2026-11-21T08:50:00Z",
      updatedAt: "2026-11-21T09:30:00Z",
    },
  ];
}

const health = {
  accountId: "acc-1",
  enterpriseId: "ENT-1",
  name: "Balon ni Lolo Uweng",
  barangay: null,
  category: "Heritage",
  accountState: "active",
  openNow: true,
  closedReason: null,
  cameras: { total: 4, counting: 3, list: [] },
  app: { status: "delayed", lastDataAt: "2026-11-23T07:46:00Z", version: "0.1.3", latestVersion: "0.1.3", computerName: null },
};

async function openRequests(page: Page, path = "/it/requests") {
  await page.clock.setFixedTime(NOW);
  await mockPortalSession(page, portalUser("it"));
  const requests = requestsFixture();
  const messages: Record<string, Message[]> = {
    "req-gate": [
      {
        id: "g1",
        requestId: "req-gate",
        authorId: "it-carlo",
        authorName: "Carlo Mendoza",
        authorRole: "it",
        kind: "status",
        message: "Carlo Mendoza started on it.",
        createdAt: "2026-11-23T07:40:00Z",
      },
      {
        id: "g2",
        requestId: "req-gate",
        authorId: "admin-1",
        authorName: "LGU Admin",
        authorRole: "admin",
        kind: "note",
        message: "Please check Gate A before Saturday.",
        createdAt: "2026-11-23T07:45:00Z",
      },
    ],
  };
  const api = { calls: [] as Array<{ method: string; path: string; body: unknown }> };
  let counter = 0;
  const now = () => new Date(NOW.getTime() + ++counter * 1000).toISOString();
  const addStatus = (request: RequestRecord, message: string) =>
    (messages[request.id] ??= []).push({ id: `s${counter}`, requestId: request.id, authorId: ME.accountId, authorName: ME.name, authorRole: "it", kind: "status", message, createdAt: now() });
  const take = (request: RequestRecord) => {
    if (!request.handledBy) Object.assign(request, { handledBy: ME, handledAt: now() });
  };
  const detail = (route: Route, request: RequestRecord) => route.fulfill(json({ ...request, messages: messages[request.id] ?? [] }));

  for (const endpoint of ["**/operational/notifications", "**/operational/alerts", "**/activity-logs", "**/accounts/enterprises", "**/accounts/email-deliveries"]) {
    await page.route(endpoint, (route) => route.fulfill(json([])));
  }
  await page.route(/\/operational\/enterprise-health\/[^/]+$/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    return id === "ENT-1" ? route.fulfill(json(health)) : route.fulfill(json({ detail: "Not found" }, 404));
  });
  await page.route(/\/operational\/requests(\/.*)?$/, async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    const parts = path.split("/").filter(Boolean).slice(2);
    if (parts.length === 0) return route.fulfill(json(requests));
    if (parts[0] === "read") return route.fulfill(json({ readCount: 1 }));
    const request = requests.find((item) => item.id === parts[0]);
    if (!request) return route.fulfill(json({ detail: "Request not found." }, 404));
    const action = parts[1];
    const body = method === "GET" ? null : (route.request().postDataJSON() as Record<string, string> | null);
    if (action) api.calls.push({ method, path: `${parts[0]}/${action}`, body });
    if (!action) return detail(route, request);
    if (action === "start") {
      if (request.handledBy) return route.fulfill(json({ detail: "Carlo Mendoza is already handling this request." }, 409));
      take(request);
      addStatus(request, `${ME.name} started on it.`);
    } else if (action === "messages") {
      take(request);
      (messages[request.id] ??= []).push({
        id: `m${counter}`,
        requestId: request.id,
        authorId: ME.accountId,
        authorName: ME.name,
        authorRole: "it",
        kind: "message",
        message: body?.message ?? "",
        createdAt: now(),
      });
    } else if (action === "status") {
      take(request);
      Object.assign(request, { status: body?.status, closedAt: body?.status === "In Progress" ? null : now() });
      addStatus(request, body?.status ?? "");
    } else if (action === "reopen") {
      Object.assign(request, { status: "In Progress", closedAt: null, handledBy: ME });
      addStatus(request, "Reopened");
    } else if (action === "group") {
      take(request);
      request.group = body?.group ?? request.group;
    }
    return detail(route, request);
  });

  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  return api;
}

// By its label rather than its role: on phones the table's rows stack as records.
const table = (page: Page) => page.locator("table[aria-label='Requests']");
const rows = (page: Page) => table(page).locator("tbody tr");
const row = (page: Page, title: string | RegExp) => rows(page).filter({ hasText: title });
const panel = (page: Page) => page.getByRole("complementary", { name: "Request details" });
const detail = (page: Page) => page.getByRole("article");

async function choose(page: Page, filter: string, option: string) {
  await page.getByRole("combobox", { name: filter }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("lists open requests in a table at full width, and starts on one from its row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await openRequests(page);

  // The header has no status line or count, and the filters are a long Search, then Type and Status
  // at the right end of the same row.
  await expect(page.getByRole("status").filter({ hasText: /picked up/ })).toHaveCount(0);
  await expect(page.getByText(/requests, newest first\./)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Handled by" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);

  await expect(table(page).getByRole("columnheader")).toHaveText(["Request", "Place", "Received", "Status", "Reference", "Action"]);
  // Open is the default status, so the resolved request is not listed; nothing is open yet.
  await expect(rows(page)).toHaveCount(4);
  await expect(panel(page)).toBeHidden();
  await expect(detail(page)).toHaveCount(0);
  const tableBox = await table(page).boundingBox();
  const searchBox = await page.getByRole("searchbox", { name: "Search" }).boundingBox();
  const statusBox = await page.getByRole("combobox", { name: "Status" }).boundingBox();
  expect(tableBox && tableBox.width > 1100).toBeTruthy();
  expect(searchBox && searchBox.width > 600).toBeTruthy();
  expect(searchBox && statusBox && Math.abs(searchBox.y + searchBox.height - (statusBox.y + statusBox.height)) < 2).toBeTruthy();
  expect(tableBox && statusBox && Math.abs(tableBox.x + tableBox.width - (statusBox.x + statusBox.width)) < 24).toBeTruthy();

  await expect(row(page, "Gate A camera")).toContainText("In progress");
  await expect(row(page, "Gate A camera")).toContainText("· Carlo Mendoza");
  const entrance = row(page, "Entrance camera keeps disconnecting");
  await expect(entrance).toContainText("Desktop app or camera problem");
  await expect(entrance).toContainText("Balon ni Lolo Uweng");
  await expect(entrance).toContainText("1:40 PM");
  await expect(entrance).toContainText("Not picked up yet");
  await expect(entrance).toContainText("REQ-000148");
  await expect(row(page, "Change of business email")).toContainText("Yesterday, 2:00 PM");
  await expect(row(page, "Gate A camera").getByRole("button", { name: /^Start on it/ })).toHaveCount(0);

  await entrance.getByRole("button", { name: "Start on it (REQ-000148)" }).click();
  await expect.poll(() => api.calls.map((call) => call.path)).toContain("req-entrance/start");
  await expect(page.getByText("You are on REQ-000148")).toBeVisible();
  await expect(entrance).toContainText("· You");
  await expect(entrance.getByRole("button", { name: /^Start on it/ })).toHaveCount(0);
  // Starting from the row does not open the request.
  await expect(page).not.toHaveURL(/request=/);
});

test("opens a request beside a narrower table and closes it again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await openRequests(page);
  const fullWidth = (await table(page).boundingBox())?.width ?? 0;

  await row(page, "Entrance camera keeps disconnecting").getByRole("button", { name: "Entrance camera keeps disconnecting" }).click();
  await expect(page).toHaveURL(/request=req-entrance/);
  await expect(row(page, "Entrance camera keeps disconnecting").getByRole("button", { name: "Entrance camera keeps disconnecting" })).toHaveAttribute("aria-current", "true");
  await expect(panel(page)).toBeVisible();
  await expect.poll(async () => (await table(page).boundingBox())?.width ?? 0).toBeLessThan(fullWidth * 0.6);
  // The narrow table keeps the request, its status and Start on it; Place, Received and Reference step out.
  await expect(table(page).getByRole("columnheader", { name: "Place" })).toBeHidden();
  await expect(table(page).getByRole("columnheader", { name: "Reference" })).toBeHidden();
  await expect(table(page).getByRole("columnheader", { name: "Status" })).toBeVisible();

  const pane = detail(page);
  await expect(pane.getByRole("heading", { level: 2, name: "Entrance camera keeps disconnecting" })).toBeVisible();
  await expect(pane.getByText("Nobody in IT has picked this up yet. The sender is waiting.")).toBeVisible();
  await expect(pane.getByRole("link", { name: "Balon ni Lolo Uweng" })).toHaveAttribute("href", "/it/enterprises/ENT-1");
  await expect(pane.getByText("Not picked up yet", { exact: true })).toBeVisible();
  await expect(pane.getByText("Delayed, last data 14 min ago")).toBeVisible();
  await expect(pane.getByText("Sent from the desktop app.")).toBeVisible();

  await pane.getByRole("button", { name: "Start on it" }).click();
  await expect.poll(() => api.calls.map((call) => call.path)).toContain("req-entrance/start");
  await expect(page.getByText("You are on REQ-000148")).toBeVisible();
  await expect(pane.getByText("You (IT Personnel)", { exact: true })).toBeVisible();
  await expect(pane.getByText(/^You started on this/)).toBeVisible();
  await expect(pane.getByRole("button", { name: "Start on it" })).toHaveCount(0);

  // The close button gives the table its full width back and returns focus to the row.
  await pane.getByRole("button", { name: "Close request details" }).click();
  await expect(page).not.toHaveURL(/request=/);
  await expect(panel(page)).toBeHidden();
  await expect.poll(async () => (await table(page).boundingBox())?.width ?? 0).toBeGreaterThan(fullWidth - 2);
  await expect(row(page, "Entrance camera keeps disconnecting").getByRole("button", { name: "Entrance camera keeps disconnecting" })).toBeFocused();

  // Escape and the browser's Back close it too.
  await row(page, "Change of enterprise name").getByRole("button", { name: "Change of enterprise name" }).click();
  await expect(detail(page).getByRole("heading", { level: 2, name: "Change of enterprise name" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/request=/);
  await row(page, "Change of enterprise name").getByRole("button", { name: "Change of enterprise name" }).click();
  await expect(page).toHaveURL(/request=req-name/);
  await page.goBack();
  await expect(page).not.toHaveURL(/request=/);
  await expect(panel(page)).toBeHidden();
});

test("fits the page to the window, and scrolls only the table and the request", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await openRequests(page);
  const scroller = page.locator("[data-page-scroller]");
  const tablePane = page.locator(".it-requests__table-pane");
  const pageOverflow = () => scroller.evaluate((element) => element.scrollHeight - element.clientHeight);

  // The page itself never scrolls; the table scrolls inside itself, its foot fading while rows wait below.
  await expect(rows(page)).toHaveCount(4);
  await expect.poll(pageOverflow).toBeLessThanOrEqual(1);
  await expect.poll(() => tablePane.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  await expect(tablePane).toHaveAttribute("data-more-below", "");
  await expect(tablePane).not.toHaveAttribute("data-more-above", "");

  // At the end of the list the foot is sharp again, the top fades, and the column names stay put.
  await tablePane.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(tablePane).not.toHaveAttribute("data-more-below", "");
  await expect(tablePane).toHaveAttribute("data-more-above", "");
  await expect(table(page).getByRole("columnheader", { name: "Request" })).toBeInViewport();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeInViewport();

  // The open request fits beside the table and scrolls on its own.
  await row(page, "Change of business email").getByRole("button", { name: "Change of business email" }).click();
  await expect(detail(page).getByRole("heading", { level: 2, name: "Change of business email" })).toBeInViewport();
  await expect.poll(pageOverflow).toBeLessThanOrEqual(1);
  await expect(panel(page)).toHaveAttribute("data-more-below", "");

  // A short window scrolls the page as a whole instead.
  await page.setViewportSize({ width: 1280, height: 560 });
  await expect.poll(pageOverflow).toBeGreaterThan(0);
  await expect(tablePane).not.toHaveAttribute("data-more-below", "");
});

test("keeps the filters in the address and clears them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // An old address with the retired Handled by filter still loads, and the filter is ignored.
  await openRequests(page, "/it/requests?owner=me");
  await expect(rows(page)).toHaveCount(4);

  await choose(page, "Status", "All statuses");
  await expect(page).toHaveURL(/status=all/);
  await expect(page).not.toHaveURL(/owner=/);
  await expect(rows(page)).toHaveCount(5);
  // Open requests come before closed ones.
  await expect(rows(page).last()).toContainText("Correct the September visitor total");
  await expect(row(page, "Correct the September visitor total")).toContainText("Resolved");
  await expect(row(page, "Correct the September visitor total")).toContainText("· You");

  await page.getByRole("searchbox", { name: "Search" }).fill("nothing like this");
  await expect(page).toHaveURL(/q=nothing/);
  await expect(page.getByText("No requests match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page).not.toHaveURL(/q=|status=/);
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);

  await page.goto("/it/requests?type=account-change&status=not-picked-up");
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "Type" })).toContainText("Account change");
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText("Not picked up");
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
});

test("approves an account change, and explains when a change can't be approved", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await openRequests(page, "/it/requests?request=req-email");

  const pane = detail(page);
  await expect(panel(page)).toBeVisible();
  await expect(pane.getByText("Now", { exact: true })).toBeVisible();
  await expect(pane.getByText("info@balon.example")).toBeVisible();
  await expect(pane.getByText("office@balon.example")).toBeVisible();
  await expect(pane.getByRole("button", { name: "Approve change" })).toBeDisabled();
  await expect(pane.getByText("The new email address is not verified yet, so the change can't be approved.")).toBeVisible();
  await expect(pane.getByRole("button", { name: "Move to another type" })).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "Mark resolved" })).toHaveCount(0);
  await expect(pane.getByRole("group", { name: "Quick replies" }).getByRole("button")).toHaveText(["Ask for proof", "Verify the email"]);

  await row(page, "Change of enterprise name").getByRole("button", { name: "Change of enterprise name" }).click();
  await expect(page).toHaveURL(/request=req-name/);
  await pane.getByRole("button", { name: "Approve change" }).click();
  await expect.poll(() => api.calls).toContainEqual({ method: "PATCH", path: "req-name/status", body: { status: "Approved" } });
  await expect(page.getByText("Change approved")).toBeVisible();
  await expect(page.getByText("Enterprise name is now “Balon ni Lolo Uweng Heritage Site”.")).toBeVisible();
  await expect(pane.getByText(/^Approved by you/)).toBeVisible();
  await expect(pane.getByRole("button", { name: "Reopen" })).toHaveCount(0);
  await expect(pane.getByText("This change is decided, so the conversation is closed.")).toBeVisible();
});

test("declines an account change with the reason written in the reply", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await openRequests(page, "/it/requests?request=req-email");

  const pane = detail(page);
  await pane.getByRole("button", { name: "Ask for proof" }).click();
  await expect(pane.getByRole("textbox", { name: "Your reply" })).toHaveValue("Please send a photo of the document that shows the new business email.");
  await pane.getByRole("button", { name: "Decline" }).click();
  await expect.poll(() => api.calls.map((call) => call.path)).toEqual(["req-email/messages", "req-email/status"]);
  expect(api.calls[1].body).toEqual({ status: "Resolved" });
  await expect(page.getByText("Change declined")).toBeVisible();
  await expect(pane.getByText(/^Declined by you/)).toBeVisible();
  await expect(pane.getByText("IT Personnel declined the change. The old value stays.")).toBeVisible();
  await expect(pane.getByText(/IT Personnel: Please send a photo/)).toBeVisible();
});

test("replies, resolves, reopens and moves a request", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await openRequests(page, "/it/requests?request=req-gate");

  const pane = detail(page);
  await expect(pane.getByText("Carlo Mendoza started on this at 3:40 PM. You can still reply or help.")).toBeVisible();
  await expect(pane.getByText("Note from LGU Admin, Admin")).toBeVisible();
  await expect(pane.getByText("Gate A, Main entrance")).toBeVisible();
  // ENT-2 has no health record, so the app status can't be checked.
  await expect(pane.getByText("Could not be checked")).toBeVisible();

  await pane.getByRole("button", { name: "Move to another type" }).click();
  const menu = page.getByRole("menu", { name: "Move to another type" });
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Sign-in help", "Desktop app or camera problem", "Report problem", "Other"]);
  await menu.getByRole("menuitemradio", { name: "Report problem" }).click();
  await expect.poll(() => api.calls).toContainEqual({ method: "PATCH", path: "req-gate/group", body: { group: "Report problem" } });
  await expect(page.getByText("Moved to Report problem")).toBeVisible();

  const reply = pane.getByRole("textbox", { name: "Your reply" });
  await expect(pane.getByRole("button", { name: "Send reply" })).toHaveAttribute("aria-disabled", "true");
  await pane.getByRole("button", { name: "Check the cable" }).click();
  await expect(reply).toHaveValue("Please check that the camera power and network cables are pushed in all the way.");
  await pane.getByRole("button", { name: "Send and mark resolved" }).click();
  await expect.poll(() => api.calls.map((call) => call.path)).toEqual(["req-gate/group", "req-gate/messages", "req-gate/status"]);
  await expect(page.getByText("Reply sent and resolved")).toBeVisible();
  await expect(pane.getByText("Reply from IT").first()).toBeVisible();
  await expect(pane.getByText("This request is resolved. Reopen it to reply.")).toBeVisible();

  await pane.getByRole("button", { name: "Reopen" }).click();
  await expect.poll(() => api.calls.map((call) => call.path)).toContain("req-gate/reopen");
  await expect(page.getByText("REQ-000149 is back in progress, with you.")).toBeVisible();
  await expect(pane.getByRole("textbox", { name: "Your reply" })).toBeVisible();
});

test("shows the table first on a phone, then the request as its own screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRequests(page);

  await expect(rows(page)).toHaveCount(4);
  await expect(detail(page)).toHaveCount(0);
  await row(page, "Change of enterprise name").getByRole("button", { name: "Change of enterprise name" }).click();
  await expect(detail(page).getByRole("heading", { level: 2, name: "Change of enterprise name" })).toBeInViewport();
  await expect(detail(page).getByRole("button", { name: "Close request details" })).toHaveCount(0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Requests", exact: true }).click();
  await expect(page).not.toHaveURL(/request=/);
  await expect(rows(page)).toHaveCount(4);
});
