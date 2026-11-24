// Admin Requests: every request people sent to IT, with deep links, server read marks, filters,
// the detail pane and the note-for-IT composer. The Admin can't change a request's status.
import { expect, test, type Page, type Route } from "@playwright/test";
import { json, mockPortalSession, portalUser, waitForStillPage } from "./support/session";

// 4:00 PM on Nov 23, 2026 in Manila.
const NOW = new Date("2026-11-23T08:00:00Z");
const PNG_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

type RequestRecord = Record<string, unknown> & { id: string; unread: boolean; updated: boolean };

const base = {
  enterpriseId: "ENT-001",
  enterpriseName: "San Pedro Plaza",
  requesterName: "Maria Santos",
  requesterEmail: null,
  affectedArea: null,
  camera: null,
  attachments: [],
  accountChange: null,
  closedAt: null,
};

function requestsFixture(): RequestRecord[] {
  return [
    {
      ...base,
      id: "request-1",
      code: "REQ-000123",
      group: "Desktop app or camera problem",
      title: "Entrance camera is offline",
      description: "The entrance camera stopped counting at 12:40 PM.",
      status: "In Progress",
      urgent: true,
      affectedArea: "Main entrance",
      camera: "Entrance camera",
      attachments: [{ id: "request-1:0", fileName: "camera.png", mediaType: "image/png", sizeBytes: 68, url: "/operational/requests/request-1/attachments/0" }],
      createdAt: "2026-11-23T05:05:00Z",
      updatedAt: "2026-11-23T06:20:00Z",
      unread: true,
      updated: false,
    },
    {
      ...base,
      id: "request-2",
      code: "REQ-000124",
      group: "Sign-in help",
      title: "Sign-in help",
      description: "I forgot the password of our desktop app.",
      status: "Sent",
      urgent: false,
      enterpriseId: null,
      enterpriseName: null,
      requesterName: "Joy Villanueva",
      requesterEmail: "joy@example.test",
      createdAt: "2026-11-22T02:00:00Z",
      updatedAt: "2026-11-22T02:00:00Z",
      unread: true,
      updated: false,
    },
    {
      ...base,
      id: "request-3",
      code: "REQ-000125",
      group: "Account change",
      title: "Change of contact number",
      description: "San Pedro Plaza asked to change its contact number to 09171234567.",
      status: "Sent",
      urgent: false,
      accountChange: { field: "contactNumber", label: "Contact number", currentValue: "09170000000", requestedValue: "09171234567", verification: null, canApprove: true },
      createdAt: "2026-11-21T01:00:00Z",
      updatedAt: "2026-11-21T01:00:00Z",
      unread: false,
      updated: true,
    },
  ];
}

const messagesById: Record<string, unknown[]> = {
  "request-1": [
    { id: "status-1", requestId: "request-1", authorId: "it-1", authorName: "Carlo Mendoza", authorRole: "it", kind: "status", message: "In Progress", createdAt: "2026-11-23T06:05:00Z" },
    { id: "reply-1", requestId: "request-1", authorId: "it-1", authorName: "Carlo Mendoza", authorRole: "it", kind: "message", message: "Checking the camera feed now.", createdAt: "2026-11-23T06:20:00Z" },
  ],
};

async function openRequests(page: Page, path = "/admin/requests") {
  await page.clock.setFixedTime(NOW);
  await mockPortalSession(page, portalUser("admin"));
  const requests = requestsFixture();
  const api = { notes: [] as unknown[], reads: [] as unknown[] };
  await page.route("**/operational/alerts", (route) => route.fulfill(json([])));
  await page.route("**/activity-logs", (route) => route.fulfill(json([])));
  await page.route("**/operational/requests/read", async (route) => {
    const body = route.request().postDataJSON() as { all: boolean; requestIds: string[] };
    api.reads.push(body);
    for (const request of requests) if (body.all || body.requestIds.includes(request.id)) Object.assign(request, { unread: false, updated: false });
    await route.fulfill(json({ readCount: body.all ? requests.length : body.requestIds.length }));
  });
  await page.route("**/operational/requests/*/attachments/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(PNG_PIXEL, "base64") }));
  await page.route("**/operational/requests/*/notes", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const body = route.request().postDataJSON() as { message: string };
    api.notes.push({ id, ...body });
    (messagesById[id] ??= []).push({ id: `note-${api.notes.length}`, requestId: id, authorId: "admin-1", authorName: "LGU Admin", authorRole: "admin", kind: "note", message: body.message, createdAt: NOW.toISOString() });
    await fulfillDetail(route, requests, id);
  });
  await page.route(/\/operational\/requests\/[^/]+$/, (route: Route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    // Routes added later run first, so leave POST /requests/read to its own handler.
    if (id === "read") return route.fallback();
    return fulfillDetail(route, requests, id);
  });
  await page.route("**/operational/requests", (route) => route.fulfill(json(requests)));
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  return api;
}

function fulfillDetail(route: Route, requests: RequestRecord[], id: string) {
  const request = requests.find((item) => item.id === id);
  if (!request) return route.fulfill(json({ detail: "Request not found." }, 404));
  return route.fulfill(json({ ...request, messages: messagesById[id] ?? [] }));
}

test("selects a deep-linked request and shows its details, photos and updates", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await openRequests(page, "/admin/requests?request=request-1");

  const list = page.getByRole("navigation", { name: "Requests" });
  await expect(list.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Yesterday" })).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(3);
  await expect(list.getByRole("button", { name: /Entrance camera is offline/ })).toHaveAttribute("aria-current", "true");
  await expect(list.getByRole("button", { name: /Entrance camera is offline/ })).toContainText("Urgent");
  // Opening a request marks it read on the server.
  await expect.poll(() => api.reads).toContainEqual({ all: false, requestIds: ["request-1"] });
  await expect(page.getByText("2 unread", { exact: true })).toBeVisible();

  const detail = page.getByRole("article");
  await expect(detail.getByRole("heading", { level: 2, name: "Entrance camera is offline" })).toBeVisible();
  await expect(detail.getByText("Carlo Mendoza from IT started on this at 2:05 PM.")).toBeVisible();
  await expect(detail.getByRole("link", { name: "San Pedro Plaza" })).toHaveAttribute("href", "/admin/enterprises/ENT-001");
  await expect(detail.getByText("Carlo Mendoza, IT", { exact: true })).toBeVisible();
  await expect(detail.getByText("REQ-000123", { exact: true })).toBeVisible();
  await expect(detail.getByText("Reply from Carlo Mendoza, IT")).toBeVisible();
  // The Admin has no status buttons: IT handles requests.
  await expect(detail.getByRole("button", { name: /Mark (in progress|resolved)/ })).toHaveCount(0);

  const photoButton = detail.getByRole("button", { name: "View photo camera.png" });
  await expect(photoButton.locator("img")).toBeVisible();
  await photoButton.click();
  await expect(page.getByRole("dialog", { name: "camera.png" }).getByRole("img", { name: "camera.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(photoButton).toBeFocused();
});

test("adds a note for IT that appears at the top of Latest updates", async ({ page }) => {
  const api = await openRequests(page, "/admin/requests?request=request-1");
  const detail = page.getByRole("article");
  const add = detail.getByRole("button", { name: "Add note" });
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await expect(detail.getByText("It goes to Carlo Mendoza and the IT team", { exact: false })).toBeVisible();
  await expect(detail.getByText("The enterprise doesn't see it.", { exact: false })).toBeVisible();

  const chip = detail.getByRole("button", { name: "Check remotely first" });
  await chip.click();
  const note = "Can you check this remotely first? Let me know if someone needs to go on site.";
  await expect(detail.getByLabel("Your note")).toHaveValue(note);

  await add.click();
  await expect(detail.getByText("Note added for IT.")).toBeVisible();
  expect(api.notes).toEqual([{ id: "request-1", message: note }]);
  await expect(detail.getByLabel("Your note")).toHaveValue("");
  const firstUpdate = detail.getByRole("listitem").filter({ hasText: "Note for IT from LGU Admin" });
  await expect(firstUpdate).toContainText("Just now");
  await expect(firstUpdate).toContainText(note);

  await detail.getByLabel("Your note").fill("A draft for the wrong request");
  await page.getByRole("navigation", { name: "Requests" }).getByRole("button", { name: /Sign-in help/ }).click();
  await expect(page).toHaveURL(/\?request=request-2$/);
  await expect(detail.getByLabel("Your note")).toHaveValue("");
  await expect(detail.getByText("joy@example.test")).toBeVisible();
  await expect(detail.getByText("Joy Villanueva asked for help signing in.")).toBeVisible();
});

test("filters by group and status, searches, and marks everything read", async ({ page }) => {
  const api = await openRequests(page);
  const list = page.getByRole("navigation", { name: "Requests" });
  await expect(page.getByText("3 requests, newest first.")).toBeVisible();
  await expect(list.getByRole("button", { name: /Change of contact number/ })).toContainText("Updated");
  await expect(page.getByText("2 unread", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText("All caught up", { exact: true })).toBeVisible();
  expect(api.reads).toContainEqual({ all: true, requestIds: [] });
  await page.reload();
  await expect(page.getByText("All caught up", { exact: true })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("REQ-000124");
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(page.getByText("Showing 1 of 3 requests, newest first.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search" }).fill("no such place");
  await expect(list.getByText("No requests match these filters.")).toBeVisible();
  await list.getByRole("button", { name: "Clear filters" }).click();

  await page.getByRole("combobox", { name: "Group" }).click();
  await page.getByRole("option", { name: "Account change" }).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await list.getByRole("button", { name: /Change of contact number/ }).click();
  await expect(page).toHaveURL(/\?request=request-3$/);
  const detail = page.getByRole("article");
  await expect(detail.getByText("Contact number from 09170000000 to 09171234567.", { exact: false })).toBeVisible();
  await expect(detail.getByText("Waiting for IT to approve or decline this change.")).toBeVisible();
  await page.getByRole("combobox", { name: "Group" }).click();
  await page.getByRole("option", { name: "All groups" }).click();

  await page.getByRole("combobox", { name: "Status" }).click();
  await expect(page.getByRole("option", { name: "Resolved" })).toHaveCount(0);
  await page.getByRole("option", { name: "In progress" }).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "All statuses" }).click();

});

test("explains a deep link to a request that is not listed", async ({ page }) => {
  await openRequests(page, "/admin/requests?request=missing");
  await expect(page.getByText("That request is not in the list.", { exact: false })).toBeVisible();
  await expect(page.getByRole("article").getByRole("heading", { level: 2, name: "Entrance camera is offline" })).toBeVisible();
});

test("stacks the list above the details on narrow screens in light and dark mode", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await openRequests(page, "/admin/requests?request=request-1");
  const listBox = await page.getByRole("navigation", { name: "Requests" }).boundingBox();
  const detailBox = await page.getByRole("article").boundingBox();
  expect(listBox && detailBox && detailBox.y >= listBox.y + listBox.height - 1).toBeTruthy();
  await waitForStillPage(page);
  await page.screenshot({ path: testInfo.outputPath("admin-requests-narrow-light.png"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await waitForStillPage(page);
  await page.screenshot({ path: testInfo.outputPath("admin-requests-dark.png"), fullPage: true });
});
