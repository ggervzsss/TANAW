import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";

const user = { id: "enterprise-help-user", name: "Help Enterprise", displayName: "Help Enterprise", email: "help@example.test", role: "enterprise", title: "Enterprise Account", enterpriseId: "help@tanaw.sanpedro", enterpriseName: "Help Enterprise", buildingCapacity: 100 };

async function mockEnterprise(page: Page) {
  await page.addInitScript((session) => { window.localStorage.setItem("tanaw-auth-session-remember", "true"); window.tanawAuthSession = { load: async () => session, save: async () => true, clear: async () => undefined }; }, { token: "help-token", user });
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "help-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "light", textSize: "default", interfaceScale: "default" }) }));
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await mockMlRequest(page, "*", () => mlResponse({ status: 503, body: JSON.stringify({ detail: "Unavailable in help test" }) }));
}

test("searches Enterprise guidance, opens related articles, and links to Support Tickets", async ({ page }) => {
  await mockEnterprise(page);
  await page.goto("/#/enterprise/help");
  const search = page.getByRole("searchbox", { name: "Search help articles" });
  await search.fill("backend connectivity");
  await expect(page.getByText("Review reports and synchronization")).toBeVisible();
  await search.fill("offline camera");
  await page.getByText("Troubleshoot a camera connection").click();
  await expect(page).toHaveURL(/article=camera-troubleshooting/);
  await expect(page.getByRole("heading", { name: "What to check" })).toBeVisible();
  await page.getByRole("button", { name: "Open Support Tickets" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/tickets$/);
});
