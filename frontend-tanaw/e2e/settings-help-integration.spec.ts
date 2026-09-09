import { expect, test, type Page } from "@playwright/test";

function userFor(role: "it" | "admin") {
  return { id: `${role}-integration`, email: `${role}@example.test`, displayName: `${role} Integration`, role, title: "TANAW Account", phone: null, firstName: "Integration", lastName: "User", enterpriseId: null, enterpriseName: null, category: null, managerName: null, barangay: null, address: null, buildingCapacity: 100, displayImageDataUrl: null };
}

async function mockPortal(page: Page, role: "it" | "admin") {
  const user = userFor(role);
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "integration-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "dark", textSize: "extra-large", interfaceScale: "comfortable" }) }));
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

test("integrates IT settings and help routes with browser history at enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await mockPortal(page, "it");
  await page.goto("/it/dashboard");
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await page.getByRole("button", { name: "Open account menu" }).click();
  const menu = page.getByRole("button", { name: "Display Preferences" }).locator("..");
  const box = await menu.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(361);
  await expect(page.getByRole("button", { name: "System Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Display Preferences" }).click();
  await expect(page).toHaveURL(/\/it\/display-preferences$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/it\/dashboard$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/it\/display-preferences$/);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Help Center" }).click();
  await expect(page).toHaveURL(/\/it\/help$/);
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("does not expose System Settings in the Admin account menu", async ({ page }) => {
  await mockPortal(page, "admin");
  await page.goto("/admin/profile");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await expect(page.getByRole("button", { name: "Display Preferences" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Help Center" })).toBeVisible();
  await expect(page.getByRole("button", { name: "System Settings" })).toHaveCount(0);
});
