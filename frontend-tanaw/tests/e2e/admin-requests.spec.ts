// Admin Requests: alerts, High and Urgent support tickets and profile change requests in one list,
// with deep links, read tracking, filters, the detail pane and the Message IT composer.
import { expect, test, type Page, type Route } from "@playwright/test";
import { json, mockPortalSession, portalUser, waitForStillPage } from "./support/session";

// 4:00 PM on Nov 23, 2026 in Manila.
const NOW = new Date("2026-11-23T08:00:00Z");
const PNG_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

const ticketInProgress = {
  id: "ticket-1",
  code: "TCK-000123",
  enterpriseId: "ENT-001",
  enterpriseName: "San Pedro Plaza",
  submittedBy: "San Pedro Plaza",
  category: "Camera Issue",
  priority: "Urgent",
  subject: "Entrance camera is offline",
  description: "The entrance camera stopped counting at 12:40 PM.",
  affectedArea: "Main entrance",
  cameraNode: "Entrance camera",
  attachments: [{ id: "ticket-1:0", fileName: "camera.png", mediaType: "image/png", sizeBytes: 68, url: "/operational/tickets/ticket-1/attachments/0" }],
  status: "In Review",
  createdAt: "2026-11-23T05:05:00Z",
  updatedAt: "2026-11-23T06:05:00Z",
};

const ticketResolved = {
  ...ticketInProgress,
  id: "ticket-2",
  code: "TCK-000124",
  subject: "Desktop app closes on start-up",
  description: "The desktop app closes right after it opens.",
  category: "Maintenance",
  priority: "High",
  affectedArea: null,
  cameraNode: null,
  attachments: [],
  status: "Resolved",
  createdAt: "2026-11-21T01:00:00Z",
  updatedAt: "2026-11-21T09:45:00Z",
};

const busyAlert = {
  id: "ALT-000007",
  type: "Foot Traffic Alert",
  severity: "Warning",
  urgency: "Important",
  enterprise: "San Pedro Plaza",
  requester: "San Pedro Plaza",
  summary: "San Pedro Plaza currently has 220 visitors, compared with its usual 120 around Sunday at 10 AM.",
  requiredAction: "Review the live map and coordinate with the establishment if support is needed.",
  resolutionMode: "Admin Monitoring",
  status: "New",
  owner: "Admin",
  time: "2026-11-22T02:00:00Z",
};

const enterpriseAccount = {
  id: "account-1",
  email: "plaza@example.test",
  phone: "09170000000",
  firstName: null,
  lastName: null,
  enterpriseName: "San Pedro Plaza",
  category: "Attraction",
  managerName: "Maria Santos",
  barangay: "Poblacion",
  address: null,
  latitude: null,
  longitude: null,
  locationUpdatedAt: null,
  enterpriseId: "ENT-001",
  gatewayStatus: "Connected",
  buildingCapacity: 300,
  displayName: "San Pedro Plaza",
  role: "enterprise",
  title: "Enterprise Account",
  status: "active",
  isActivated: true,
  isProtectedDefault: false,
  profileChangeRequests: [
    {
      type: "contactNumber",
      label: "Contact Number",
      requestedValue: "09171234567",
      requestedAt: "2026-11-23T01:00:00Z",
      requestId: null,
      status: "pending_review",
      isVerified: false,
      canApprove: true,
      expiresAt: null,
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  lastLoginAt: null,
};

const statusLog = {
  id: "log-status",
  timestamp: "2026-11-23T06:05:00Z",
  category: "IT Activity",
  severity: "Success",
  actor: "Carlo Mendoza",
  actorRole: "IT Personnel",
  action: "Update Support Ticket Status",
  target: "TCK-000123",
  summary: "Carlo Mendoza updated TCK-000123 from Open to In Review.",
  sourceId: "ticket-1",
  metadata: { status: "In Review", ticketCode: "TCK-000123", enterpriseId: "ENT-001" },
};

type MockApi = { messages: unknown[]; alertUpdates: unknown[] };

async function openRequests(page: Page, path = "/admin/requests"): Promise<MockApi> {
  const api: MockApi = { messages: [], alertUpdates: [] };
  const logs: unknown[] = [statusLog];
  let alert = { ...busyAlert };
  await page.clock.setFixedTime(NOW);
  await mockPortalSession(page, portalUser("admin", { id: "admin-requests-e2e", displayName: "LGU Admin" }));
  await page.route("**/operational/notifications", (route) => route.fulfill(json([])));
  await page.route("**/operational/alerts", (route) => route.fulfill(json([alert])));
  await page.route("**/operational/alerts/*/status", async (route) => {
    const body = route.request().postDataJSON() as { status: string };
    api.alertUpdates.push(body);
    alert = { ...alert, status: body.status };
    await route.fulfill(json(alert));
  });
  await page.route("**/operational/tickets", (route) => route.fulfill(json([ticketInProgress, ticketResolved])));
  await page.route("**/operational/tickets/*", (route) => fulfillTicketDetail(route));
  await page.route("**/operational/tickets/*/attachments/*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(PNG_PIXEL, "base64") }));
  await page.route("**/accounts/enterprises", (route) => route.fulfill(json([enterpriseAccount])));
  await page.route("**/activity-logs", (route) => route.fulfill(json(logs)));
  await page.route("**/operational/requests/messages", async (route) => {
    const body = route.request().postDataJSON() as { sourceType: string; sourceId: string; message: string };
    api.messages.push(body);
    const activity = {
      id: `log-message-${api.messages.length}`,
      timestamp: NOW.toISOString(),
      category: "Admin Operation",
      severity: "Info",
      actor: "LGU Admin",
      actorRole: "Admin",
      action: "Message IT",
      target: "TCK-000123",
      summary: "LGU Admin sent IT a message about TCK-000123.",
      sourceId: body.sourceId,
      metadata: { sourceType: body.sourceType, message: body.message, recipientCount: 2 },
    };
    logs.unshift(activity);
    await route.fulfill(json({ activity, recipientCount: 2 }, 201));
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  return api;
}

function fulfillTicketDetail(route: Route) {
  const id = new URL(route.request().url()).pathname.split("/").pop();
  const ticket = id === "ticket-2" ? ticketResolved : ticketInProgress;
  const messages =
    id === "ticket-1"
      ? [{ id: "message-1", ticketId: "ticket-1", authorId: "it-1", authorName: "Carlo Mendoza", authorRole: "it", message: "Checking the camera feed now.", createdAt: "2026-11-23T06:20:00Z" }]
      : [];
  return route.fulfill(json({ ...ticket, messages }));
}

test("selects a deep-linked ticket and shows its details, photos and updates", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRequests(page, "/admin/requests?ticket=ticket-1");

  await expect(page.getByRole("main").getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/admin/dashboard");
  const list = page.getByRole("navigation", { name: "Requests" });
  await expect(list.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Yesterday" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Nov 21" })).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(4);
  await expect(list.getByRole("button", { name: /Entrance camera is offline/ })).toHaveAttribute("aria-current", "true");
  // The opened ticket is read; the other three are still new.
  await expect(page.getByText("3 unread", { exact: true })).toBeVisible();

  const detail = page.getByRole("article");
  await expect(detail.getByRole("heading", { level: 2, name: "Entrance camera is offline" })).toBeVisible();
  await expect(detail.getByText("Carlo Mendoza from IT started on this at 2:05 PM and is working on it.")).toBeVisible();
  await expect(detail.getByRole("link", { name: "San Pedro Plaza" })).toHaveAttribute("href", "/admin/enterprises/ENT-001");
  await expect(detail.getByText("Maria Santos, San Pedro Plaza", { exact: true })).toBeVisible();
  await expect(detail.getByText("Carlo Mendoza, IT", { exact: true })).toBeVisible();
  await expect(detail.getByText("TCK-000123", { exact: true })).toBeVisible();
  await expect(detail.getByText("Reply from Carlo Mendoza, IT")).toBeVisible();
  await expect(detail.getByText("Checking the camera feed now.")).toBeVisible();

  const photoButton = detail.getByRole("button", { name: "View photo camera.png" });
  await expect(photoButton.locator("img")).toBeVisible();
  await photoButton.click();
  const photo = page.getByRole("dialog", { name: "camera.png" });
  await expect(photo.getByRole("img", { name: "camera.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(photo).toHaveCount(0);
  await expect(photoButton).toBeFocused();
});

test("sends a message to IT that appears at the top of Latest updates", async ({ page }) => {
  const api = await openRequests(page, "/admin/requests?ticket=ticket-1");
  const detail = page.getByRole("article");
  const send = detail.getByRole("button", { name: "Send to IT" });
  await expect(send).toHaveAttribute("aria-disabled", "true");
  await expect(detail.getByText("It goes to Carlo Mendoza and the IT team and is added to Latest updates.")).toBeVisible();

  const chip = detail.getByRole("button", { name: "Check remotely first" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const message = "Can you check this remotely first? Let me know if someone needs to go on site.";
  await expect(detail.getByLabel("Your message")).toHaveValue(message);

  await send.click();
  await expect(detail.getByText("Message sent to IT.")).toBeVisible();
  expect(api.messages).toEqual([{ sourceType: "support.ticket", sourceId: "ticket-1", message }]);
  await expect(detail.getByLabel("Your message")).toHaveValue("");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  const firstUpdate = detail.getByRole("listitem").filter({ hasText: "Message from LGU Admin" });
  await expect(firstUpdate).toContainText("Just now");
  await expect(firstUpdate).toContainText(message);

  // Choosing another request clears the draft and the sent note.
  await detail.getByLabel("Your message").fill("A draft for the wrong request");
  await page.getByRole("navigation", { name: "Requests" }).getByRole("button", { name: /Desktop app closes on start-up/ }).click();
  await expect(page).toHaveURL(/\?ticket=ticket-2$/);
  await expect(detail.getByLabel("Your message")).toHaveValue("");
  await expect(detail.getByText("Message sent to IT.")).toHaveCount(0);
  await expect(detail.getByText("Resolved by Carlo Mendoza", { exact: false })).toHaveCount(0);
  await expect(detail.getByText("Resolved.", { exact: true })).toBeVisible();
});

test("filters, searches and remembers what this Admin has read", async ({ page }) => {
  await openRequests(page);
  const list = page.getByRole("navigation", { name: "Requests" });
  await expect(page.getByText("4 requests, newest first.")).toBeVisible();
  // The newest request opens by default and counts as read.
  await expect(list.getByRole("button", { name: /Entrance camera is offline/ })).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("3 unread", { exact: true })).toBeVisible();
  await expect(list.getByRole("button", { name: /Busier than usual/ })).toContainText("New");

  await page.getByRole("searchbox", { name: "Search" }).fill("TCK-000124");
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(page.getByText("Showing 1 of 4 requests, newest first.")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("no such place");
  await expect(list.getByText("No requests match these filters.")).toBeVisible();
  await list.getByRole("button", { name: "Clear filters" }).click();
  await expect(list.getByRole("button")).toHaveCount(4);

  await page.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Account and access" }).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await list.getByRole("button", { name: /Change of contact number/ }).click();
  await expect(page).toHaveURL(/\?account=account-1&change=contactNumber$/);
  await expect(page.getByRole("article").getByText("San Pedro Plaza asked to change its contact number to 09171234567.", { exact: false })).toBeVisible();
  await expect(page.getByRole("article").getByText("Not accepted yet")).toBeVisible();

  await page.getByRole("combobox", { name: "Progress" }).click();
  await page.getByRole("option", { name: "Resolved" }).click();
  await expect(list.getByText("No requests match these filters.")).toBeVisible();
  await list.getByRole("button", { name: "Clear filters" }).click();

  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText("All caught up", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  await page.reload();
  await expect(page.getByText("All caught up", { exact: true })).toBeVisible();
});

test("handles an Admin-owned alert from a notification link", async ({ page }) => {
  const api = await openRequests(page, "/admin/requests?alert=ALT-000007");
  const detail = page.getByRole("article");
  await expect(detail.getByRole("heading", { level: 2, name: "Busier than usual" })).toBeVisible();
  await expect(detail.getByText("Needs attention").first()).toBeVisible();
  await expect(detail.getByText("TANAW, automatic alert", { exact: true })).toBeVisible();

  await detail.getByRole("button", { name: "Mark in progress" }).click();
  await expect(detail.getByText("Alert marked in progress.")).toBeVisible();
  expect(api.alertUpdates).toEqual([{ status: "In Review" }]);
  await expect(detail.getByText("In progress").first()).toBeVisible();
});

test("explains a deep link to a request that is not listed", async ({ page }) => {
  await openRequests(page, "/admin/requests?ticket=ticket-missing");
  await expect(page.getByText("That request is not in the list.", { exact: false })).toBeVisible();
  await expect(page.getByRole("article").getByRole("heading", { level: 2, name: "Entrance camera is offline" })).toBeVisible();
});

test("stacks the list above the details on narrow screens in light and dark mode", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await openRequests(page, "/admin/requests?ticket=ticket-1");
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
