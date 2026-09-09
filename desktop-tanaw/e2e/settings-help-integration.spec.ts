import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";

const user = { id: "enterprise-integration", name: "Integration Enterprise", displayName: "Integration Enterprise", email: "integration@example.test", role: "enterprise", title: "Enterprise Account", enterpriseId: "integration@tanaw.sanpedro", enterpriseName: "Integration Enterprise", buildingCapacity: 100 };

async function mockEnterprise(page: Page) {
  await page.addInitScript((session) => { window.localStorage.setItem("tanaw-auth-session-remember", "true"); window.localStorage.setItem("tanaw-enterprise-theme", "dark"); window.tanawAuthSession = { load: async () => session, save: async () => true, clear: async () => undefined }; }, { token: "integration-token", user });
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "integration-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "dark", textSize: "extra-large", interfaceScale: "comfortable" }) }));
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await mockMlRequest(page, "*", () => mlResponse({ status: 503, body: JSON.stringify({ detail: "Unavailable in integration test" }) }));
}

test("integrates Enterprise display and Help Center navigation at practical window sizes", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mockEnterprise(page);
  await page.goto("/#/enterprise/dashboard");
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Display Preferences" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/display-preferences$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Help Center" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/help$/);
  await expect(page.getByRole("searchbox", { name: "Search help articles" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
