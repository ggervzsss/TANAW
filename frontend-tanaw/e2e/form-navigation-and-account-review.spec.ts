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

test("applies pending-account actions, optional LGU contact copy, and readable dark warnings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await restoreItSession(page);
  await page.route("**/accounts/lgu", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/it/lgu-accounts");

  await page.getByRole("button", { name: "Create LGU Account" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create LGU Account" });
  await expect(createDialog.getByText("Contact Number (Optional)", { exact: true })).toBeVisible();
  await expect(createDialog.getByText("+63", { exact: true })).toBeVisible();
  await createDialog.getByRole("button", { name: "Close modal" }).click();

  await page.route("**/accounts/enterprises", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ ...enterprise, isActivated: false, profileChangeRequests: [] }]),
    }),
  );
  await page.goto("/it/enterprise-accounts");
  await page.getByText(enterprise.enterpriseName, { exact: true }).first().click();
  let detailsDialog = page.getByRole("dialog", { name: "Enterprise Details" });
  await expect(detailsDialog.getByRole("button", { name: "Resend activation email" })).toBeVisible();
  await expect(detailsDialog.getByRole("button", { name: "Deactivate enterprise" })).toHaveCount(0);
  await detailsDialog.getByRole("button", { name: "Close modal" }).click();

  await page.route("**/accounts/enterprises", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ ...enterprise, profileChangeRequests: [] }]),
    }),
  );
  await page.reload();
  await page.getByText(enterprise.enterpriseName, { exact: true }).first().click();
  detailsDialog = page.getByRole("dialog", { name: "Enterprise Details" });
  await detailsDialog.getByRole("button", { name: "Deactivate enterprise" }).click();
  const warningDialog = page.getByRole("dialog", { name: "Deactivate Enterprise" });
  const warningPanel = warningDialog.locator(".tanaw-warning-panel");
  await expect(warningPanel).toBeVisible();
  await expect(warningPanel.getByText("This enterprise account will lose TANAW access.", { exact: true })).toHaveCSS("color", "rgb(252, 211, 77)");
  await expect(warningPanel.getByText(/will not be able to sign in/)).not.toHaveCSS("color", "rgb(120, 53, 15)");
  await expect(warningPanel).not.toHaveCSS("background-color", "rgb(254, 243, 199)");
});

test("formats Technical Issue timestamps in Philippine Time", async ({ page }) => {
  const alert = {
    id: "ALT-000099",
    type: "Failed Login Threshold",
    severity: "Warning",
    enterprise: "Test Enterprise",
    requester: "Test User",
    summary: "The account reached the failed sign-in threshold.",
    requiredAction: "Review account activity.",
    resolutionMode: "Remote Review",
    status: "New",
    owner: "IT",
    time: "2026-07-23T12:11:04.071391+00:00",
  };
  await restoreItSession(page);
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([alert]) }));
  await page.route("**/operational/tickets", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/accounts/email-deliveries", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto(`/it/work-center?view=issues&alert=${alert.id}`);

  const dialog = page.getByRole("dialog", { name: "Technical Issue Details" });
  const timestamp = dialog.locator("time");
  await expect(timestamp).toHaveAttribute("datetime", alert.time);
  await expect(timestamp).toContainText("Jul 23, 2026");
  await expect(timestamp).toContainText("8:11 PM");
  await expect(dialog.getByText(alert.time, { exact: true })).toHaveCount(0);
});
