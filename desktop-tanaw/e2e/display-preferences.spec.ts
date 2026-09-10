import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";

const user = {
  id: "enterprise-display-user",
  name: "Display Enterprise",
  displayName: "Display Enterprise",
  email: "display-enterprise@example.test",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "display_enterprise@tanaw.sanpedro",
  enterpriseName: "Display Enterprise",
  buildingCapacity: 100,
};

async function mockDisplayAccount(page: Page) {
  let preferences = { theme: "light", textSize: "default", interfaceScale: "default" };
  await page.addInitScript((session) => {
    window.localStorage.setItem("tanaw-auth-session-remember", "true");
    window.tanawAuthSession = { load: async () => session, save: async () => true, clear: async () => undefined };
  }, { token: "display-token", user });
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "display-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", async (route) => {
    if (route.request().method() === "PATCH") preferences = { ...preferences, ...(await route.request().postDataJSON()) };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preferences) });
  });
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await mockMlRequest(page, "*", () => mlResponse({ status: 503, body: JSON.stringify({ detail: "Unavailable in display test" }) }));
  return () => preferences;
}

test("applies and reloads enterprise display preferences", async ({ page }) => {
  const readPreferences = await mockDisplayAccount(page);
  await page.goto("/#/enterprise/display-preferences");
  await expect(page.getByRole("heading", { name: "Display Preferences" })).toBeVisible();
  await page.getByRole("radio", { name: /Large Makes text easier/ }).check({ force: true });
  await page.getByRole("radio", { name: /Compact Reduces workspace/ }).check({ force: true });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  expect(readPreferences()).toMatchObject({ textSize: "large", interfaceScale: "compact" });
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("font-size", "18px");
  await expect(page.locator("html")).toHaveAttribute("data-interface-scale", "compact");
});
