import { expect, test, type Page } from "@playwright/test";

const itUser = {
  id: "it-refinement-test",
  email: "it-refinements@example.test",
  displayName: "IT Refinement Tester",
  role: "it",
  title: "IT Personnel",
  phone: null,
  firstName: "IT",
  lastName: "Tester",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

const enterprise = {
  id: "enterprise-refinement-test",
  email: "enterprise@example.test",
  phone: "+639171110003",
  firstName: null,
  lastName: null,
  enterpriseName: "Lolo Uwenger Pilgrim Church",
  category: "tourism",
  managerName: "Enterprise Manager",
  barangay: "San Antonio",
  address: "Mahogany Street",
  latitude: 14.353372,
  longitude: 121.030528,
  locationUpdatedAt: "2026-07-21T13:00:00Z",
  enterpriseId: "lolo_uwenger_001@tanaw.sanpedro",
  gatewayStatus: "online",
  buildingCapacity: 100,
  displayName: "Lolo Uwenger Pilgrim Church",
  role: "enterprise",
  title: "Enterprise Account",
  status: "active",
  isActivated: true,
  isProtectedDefault: false,
  profileChangeRequests: [
    {
      type: "contactNumber",
      label: "Contact Number",
      requestedValue: "+639171119999",
      requestedAt: "2026-07-21T13:21:00Z",
      requestId: "profile-request-1",
      status: "pending_review",
      isVerified: true,
      canApprove: true,
      expiresAt: null,
    },
  ],
  createdAt: "2026-05-01T00:00:00Z",
  lastLoginAt: null,
};

const activity = {
  id: "ACTIVITY-REFINEMENT-1",
  timestamp: "2026-07-21T13:42:00Z",
  category: "IT Activity",
  severity: "Success",
  actor: "IT Refinement Tester",
  actorRole: "IT Personnel",
  action: "Retry Email Delivery",
  target: "enterprise@example.test",
  summary: "IT Personnel queued a retry for account activation email delivery while preserving the complete audit context.",
  sourceId: "delivery-1",
  metadata: {},
};

async function restoreItSession(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.route("**/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "it-refinement-token", user: itUser }) }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(itUser) }));
  await page.route("**/auth/preferences", (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme: "dark" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/accounts/enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([enterprise]) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/activity-logs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([activity]) }));
}

test("keeps the enterprise review queue compact and reveals the first invalid custom select inside its modal", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await restoreItSession(page);
  await page.goto("/it/enterprise-accounts");

  const requestQueue = page.locator(".tanaw-request-queue");
  await expect(requestQueue).toBeVisible();
  const queueBox = await requestQueue.boundingBox();
  expect(queueBox).not.toBeNull();
  expect(queueBox!.height).toBeLessThan(250);
  await expect(requestQueue).not.toHaveCSS("background-color", "rgb(254, 243, 199)");
  await expect(requestQueue.getByText("1 pending")).toBeVisible();
  await expect(requestQueue.getByText("+639171110003")).toBeVisible();
  await expect(requestQueue.getByText("+639171119999")).toBeVisible();
  await expect(requestQueue.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(requestQueue.getByRole("button", { name: "Decline" })).toBeVisible();

  await page.getByRole("button", { name: "Register Enterprise" }).click();
  const dialog = page.getByRole("dialog", { name: "Register Enterprise" });
  const modalBody = dialog.locator("[data-modal-scroll-container]");
  await dialog.getByLabel("Enterprise Name").fill("New Refinement Enterprise");
  await dialog.getByLabel("Contact First Name").fill("David");
  await dialog.getByLabel("Contact Last Name").fill("Vallejera");
  await dialog.getByLabel("Contact Email").fill("new-enterprise@example.test");
  await dialog.getByLabel("Block / Lot / Street").fill("Block 1 Mahogany Street");
  const barangay = dialog.getByRole("combobox", { name: "Barangay" });
  await barangay.click();
  await page.getByRole("option", { name: "San Antonio" }).click();

  await modalBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const scrollTopBefore = await modalBody.evaluate((element) => element.scrollTop);
  expect(scrollTopBefore).toBeGreaterThan(0);
  const windowScrollBefore = await page.evaluate(() => window.scrollY);
  await dialog.getByRole("button", { name: "Register Enterprise" }).click();

  const category = dialog.getByRole("combobox", { name: "Enterprise Type / Category" });
  await expect(category).toBeFocused();
  await expect(category).toBeInViewport();
  await expect(category).toHaveAttribute("aria-invalid", "true");
  await expect(category).toHaveAttribute("aria-describedby", "category-description");
  await expect(dialog.getByText("Choose a valid enterprise type.")).toBeVisible();
  await expect(page.getByText("Please complete the highlighted required field.")).toHaveCount(1);
  await expect(dialog.getByLabel("Enterprise Name")).toHaveValue("New Refinement Enterprise");
  await expect(dialog.getByLabel("Contact Email")).toHaveValue("new-enterprise@example.test");
  await expect.poll(() => modalBody.evaluate((element) => element.scrollTop)).toBeLessThan(scrollTopBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(windowScrollBefore);

  await category.press("Enter");
  await category.press("Enter");
  await expect(category).toContainText("Events Venue");
  await expect(category).toBeFocused();

  await dialog.getByRole("button", { name: "Register Enterprise" }).click();
  await expect(dialog.getByRole("button", { name: "Full Map View" })).toBeFocused();
  await expect(dialog.getByRole("alert").filter({ hasText: "Choose a map location inside San Pedro before saving." })).toBeVisible();
  await expect(dialog.getByLabel("Enterprise Name")).toHaveValue("New Refinement Enterprise");
});

test("balances Action and Summary in Activity Details and collapses the shared grid at narrow widths", async ({ page }) => {
  await restoreItSession(page);
  await page.goto("/it/system-logs");
  await page.getByText(activity.summary, { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Activity Details" });
  const actionCard = dialog.getByText("Action", { exact: true }).locator("..");
  const summaryCard = dialog.getByText("Summary", { exact: true }).locator("..");
  const wideBoxes = await Promise.all([actionCard.boundingBox(), summaryCard.boundingBox()]);
  expect(wideBoxes[0]).not.toBeNull();
  expect(wideBoxes[1]).not.toBeNull();
  expect(Math.abs(wideBoxes[0]!.y - wideBoxes[1]!.y)).toBeLessThan(2);

  await page.setViewportSize({ width: 600, height: 800 });
  const narrowBoxes = await Promise.all([actionCard.boundingBox(), summaryCard.boundingBox()]);
  expect(narrowBoxes[0]).not.toBeNull();
  expect(narrowBoxes[1]).not.toBeNull();
  expect(narrowBoxes[1]!.y).toBeGreaterThan(narrowBoxes[0]!.y + narrowBoxes[0]!.height);
});
