// IT Work Center: open requests first and newest first, deciding an account change, and live alerts.
import { expect, test, type Page } from "@playwright/test";

const itUser = {
  id: "it-work-center-ordering",
  email: "it.ordering@example.test",
  displayName: "IT Personnel",
  role: "it",
  title: "IT Personnel",
  phone: null,
  firstName: "IT",
  lastName: "Personnel",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

const request = (id: string, overrides: Record<string, unknown>) => ({
  id,
  code: id,
  group: "Desktop app or camera problem",
  title: `${id} title`,
  description: `${id} description`,
  status: "In Progress",
  enterpriseId: "ENT-1",
  enterpriseName: "Ordering Test Enterprise",
  requesterName: "Front desk",
  requesterEmail: null,
  attachments: [],
  accountChange: null,
  unread: false,
  updated: false,
  createdAt: "2026-07-29T10:00:00Z",
  updatedAt: "2026-07-29T10:00:00Z",
  ...overrides,
});

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockWorkCenter(page: Page) {
  let requests = [
    request("REQ-RESOLVED", { status: "Resolved", createdAt: "2026-07-29T14:00:00Z" }),
    request("REQ-NORMAL-NEW", { createdAt: "2026-07-29T13:00:00Z" }),
    request("REQ-OPEN-OLD", { createdAt: "2026-07-29T09:00:00Z" }),
    request("REQ-CHANGE", {
      group: "Account change",
      title: "Change of contact number",
      createdAt: "2026-07-29T12:00:00Z",
      accountChange: { field: "contactNumber", label: "Contact number", currentValue: "09170000000", requestedValue: "09171234567", verification: null, canApprove: true },
    }),
    request("REQ-NAME", {
      group: "Account change",
      title: "Change of enterprise name",
      createdAt: "2026-07-29T08:00:00Z",
      accountChange: { field: "enterpriseName", label: "Enterprise name", currentValue: "Ordering Test Enterprise", requestedValue: "Ordering Test Place", verification: null, canApprove: true },
    }),
  ];
  const decisions: unknown[] = [];

  await page.route("**/auth/session", (route) => route.fulfill(json({ token: "it-ordering-token", user: itUser })));
  await page.route("**/auth/me", (route) => route.fulfill(json(itUser)));
  await page.route("**/auth/preferences", (route) => route.fulfill(json({ theme: "light" })));
  for (const endpoint of ["**/operational/notifications", "**/accounts/enterprises", "**/accounts/email-deliveries", "**/activity-logs"]) {
    await page.route(endpoint, (route) => route.fulfill(json([])));
  }
  await page.route("**/operational/alerts", (route) =>
    route.fulfill(
      json([
        {
          id: "ALT-000001",
          type: "Camera Not Counting",
          severity: "Critical",
          status: "Active",
          enterpriseId: "ENT-1",
          enterpriseName: "Ordering Test Enterprise",
          camera: "Gate A",
          summary: "The Gate A camera at Ordering Test Enterprise is not counting.",
          detail: "Camera: Gate A · Error: the connection was refused",
          startedAt: "2026-07-29T10:00:00Z",
        },
      ]),
    ),
  );
  await page.route(/\/operational\/requests\/[^/]+\/status$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const { status } = route.request().postDataJSON() as { status: string };
    decisions.push({ id, status });
    requests = requests.map((item) => (item.id === id ? { ...item, status } : item));
    return route.fulfill(json({ ...requests.find((item) => item.id === id), messages: [] }));
  });
  await page.route(/\/operational\/requests\/[^/]+$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill(json({ ...requests.find((item) => item.id === id), messages: [] }));
  });
  await page.route("**/operational/requests", (route) => route.fulfill(json(requests)));
  return decisions;
}

test("lists open requests first, newest first, and approves an account change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const decisions = await mockWorkCenter(page);
  await page.goto("/it/work-center");

  const codes = page.locator("tbody tr td:first-child");
  await expect(codes).toHaveText(["REQ-NORMAL-NEW", "REQ-CHANGE", "REQ-OPEN-OLD", "REQ-NAME", "REQ-RESOLVED"]);
  await expect(page.locator("tbody")).not.toContainText("Urgent");
  await expect(page.getByRole("columnheader", { name: "Urgent" })).toHaveCount(0);

  await page.getByPlaceholder("Search reference, place, person, request or group").fill("contact number");
  await expect(codes).toHaveText(["REQ-CHANGE"]);
  await page.locator("tbody tr").first().click();
  const dialog = page.getByRole("dialog", { name: "Change of contact number" });
  await expect(dialog).toContainText("09170000000 → 09171234567");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => decisions).toEqual([{ id: "REQ-CHANGE", status: "Approved" }]);
  await expect(dialog.getByText("Approved").first()).toBeVisible();
});

test("resolves an account change without approving it, with no Decline action", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const decisions = await mockWorkCenter(page);
  await page.goto("/it/work-center");

  await page.getByPlaceholder("Search reference, place, person, request or group").fill("enterprise name");
  await page.locator("tbody tr").first().click();
  const dialog = page.getByRole("dialog", { name: "Change of enterprise name" });
  await expect(dialog.getByRole("button", { name: "Decline" })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "Urgent" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Resolve without approving" }).click();
  await expect.poll(() => decisions).toEqual([{ id: "REQ-NAME", status: "Resolved" }]);
  await expect(dialog.getByText("Resolved").first()).toBeVisible();
});

test("shows live alerts with IT details and no status buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockWorkCenter(page);
  await page.goto("/it/work-center?view=alerts");

  const alerts = page.getByRole("region", { name: "Live alerts" });
  await expect(alerts).toContainText("Camera not counting");
  await expect(alerts).toContainText("Ordering Test Enterprise · Gate A");
  await expect(alerts).toContainText("Error: the connection was refused");
  await expect(alerts.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Live Alerts/ })).toContainText("1");
});
