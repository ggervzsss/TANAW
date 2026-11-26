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
  category: "Golf",
  attraction: { code: "401", typeCode: "4", type: "Sports and Recreational Facilities", category: "Golf", portfolioCategory: "Leisure and Entertainment Tourism", ntdpCode: "TD404" },
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

async function restoreItSession(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "it-refinement-token", user: itUser }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(itUser) }));
  await page.route("**/auth/preferences", (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme: "dark" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/accounts/enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([enterprise]) }));
  for (const endpoint of ["**/accounts/lgu", "**/operational/notifications", "**/operational/requests", "**/operational/enterprise-health"]) {
    await page.route(endpoint, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  }
}

test("reveals the first invalid custom select inside the Register enterprise sheet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await restoreItSession(page);
  await page.goto("/it/enterprises");

  const register = page.getByRole("button", { name: "Register enterprise" });
  await register.click();
  await expect(page).toHaveURL(/register=1/);
  const sheet = page.getByRole("dialog", { name: "Register enterprise" });
  const sheetBody = sheet.locator("[data-modal-scroll-container]");
  await sheet.getByLabel("Enterprise name").fill("New Refinement Enterprise");
  await sheet.getByLabel("Block, lot and street").fill("Block 1 Mahogany Street");
  await sheet.getByRole("combobox", { name: "Barangay" }).click();
  await page.getByRole("option", { name: "San Antonio" }).click();
  await sheet.getByLabel("First name").fill("David");
  await sheet.getByLabel("Last name").fill("Vallejera");
  await sheet.getByLabel("Owner email").fill("new-enterprise@example.test");

  await sheetBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const scrollTopBefore = await sheetBody.evaluate((element) => element.scrollTop);
  expect(scrollTopBefore).toBeGreaterThan(0);
  const windowScrollBefore = await page.evaluate(() => window.scrollY);
  await sheet.getByRole("button", { name: "Register and send invitation" }).click();

  // The attraction type is the first missing field: the sheet scrolls back up to it and focuses it.
  const category = sheet.getByRole("combobox", { name: "Attraction type" });
  await expect(category).toBeFocused();
  await expect(category).toBeInViewport();
  await expect(category).toHaveAttribute("aria-invalid", "true");
  await expect(sheet.getByText("Choose a DOT attraction category.")).toBeVisible();
  await expect(page.getByText("Please complete the highlighted required field.")).toHaveCount(1);
  await expect(sheet.getByLabel("Enterprise name")).toHaveValue("New Refinement Enterprise");
  await expect(sheet.getByLabel("Owner email")).toHaveValue("new-enterprise@example.test");
  await expect.poll(() => sheetBody.evaluate((element) => element.scrollTop)).toBeLessThan(scrollTopBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(windowScrollBefore);

  await category.press("Enter");
  await page.getByPlaceholder("Search category, type or code").fill("401");
  await page.getByRole("option", { name: /^Golf/ }).click();
  await expect(category).toContainText("Golf");
  await page.screenshot({ path: testInfo.outputPath("enterprise-dot-classification-dark.png"), animations: "disabled" });
  await expect(category).toBeFocused();

  // With every field filled, the missing map pin is next.
  await sheet.getByRole("button", { name: "Register and send invitation" }).click();
  await expect(sheet.getByText("Place the pin on the map inside San Pedro before registering.")).toBeVisible();
  await expect(sheet.getByLabel("Enterprise name")).toHaveValue("New Refinement Enterprise");

  // Escape closes the open list first, then the sheet, and focus returns to the button that opened it.
  await category.press("Enter");
  await expect(page.getByPlaceholder("Search category, type or code")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await expect(category).toBeFocused();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Enterprise name")).toHaveValue("New Refinement Enterprise");

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/register=1/);
  await expect(register).toBeFocused();
});

// Resending an invitation and deactivating an enterprise are covered on Manage an enterprise in it-enterprises.spec.ts.
test("marks the LGU phone number optional with its +63 prefix in the invite sheet, in dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await restoreItSession(page);
  await page.goto("/it/personnel");
  await expect(page.locator("html")).toHaveClass(/dark/);

  const invite = page.getByRole("button", { name: "Invite personnel" });
  await invite.click();
  const sheet = page.getByRole("dialog", { name: "Invite personnel" });
  await expect(sheet.getByText("Phone (optional)", { exact: true })).toBeVisible();
  await expect(sheet.getByText("+63", { exact: true })).toBeVisible();
  await expect(sheet.getByText("A mobile number after +63: 10 digits starting with 9.")).toBeVisible();
  await expect(sheet).not.toHaveCSS("background-color", "rgb(255, 255, 255)");

  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(invite).toBeFocused();
});
