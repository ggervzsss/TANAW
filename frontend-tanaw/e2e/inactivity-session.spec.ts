import { expect, test, type Page } from "@playwright/test";

const adminUser = {
  id: "admin-inactivity-test",
  email: "admin-inactivity@example.test",
  displayName: "Inactivity Test Admin",
  role: "admin",
  title: "LGU Admin",
  phone: null,
  firstName: "Inactivity",
  lastName: "Admin",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

async function mockAuthenticatedAdmin(page: Page, onLogout: () => void) {
  await page.route("**/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "admin-inactivity-token", user: adminUser }) }),
  );
  await page.route("**/auth/logout", (route) => {
    onLogout();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
  });
  await page.route("**/auth/preferences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "dark" }) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/activity-logs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

test("warns at five minutes and lets pointer activity or Stay Signed In reset the session", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined });
  });
  await page.clock.install({ time: new Date("2026-07-18T12:00:00Z") });
  await mockAuthenticatedAdmin(page, () => undefined);
  await page.goto("/admin/alerts-monitor");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();

  await page.clock.fastForward(5 * 60 * 1000 + 300);
  let warning = page.getByRole("alertdialog", { name: "Session Expiring" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("signed out in one minute");
  await expect(warning).toContainText("five minutes without activity");
  await warning.dispatchEvent("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 20 });
  await expect(warning).toBeHidden();

  await page.clock.fastForward(5 * 60 * 1000 + 300);
  warning = page.getByRole("alertdialog", { name: "Session Expiring" });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("button", { name: "Stay Signed In" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(warning).toBeHidden();

  await page.clock.fastForward(5 * 60 * 1000 + 300);
  warning = page.getByRole("alertdialog", { name: "Session Expiring" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Stay Signed In" }).click();
  await expect(warning).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/alerts-monitor$/);
});

test("automatically logs out after the additional minute and synchronizes logout to another tab", async ({ context, page }) => {
  let logoutCalls = 0;
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined });
  });
  await page.clock.install({ time: new Date("2026-07-18T12:00:00Z") });
  await mockAuthenticatedAdmin(page, () => {
    logoutCalls += 1;
  });
  await page.goto("/admin/alerts-monitor");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();

  const secondTab = await context.newPage();
  await secondTab.clock.install({ time: new Date("2026-07-18T12:00:00Z") });
  await mockAuthenticatedAdmin(secondTab, () => undefined);
  await secondTab.goto("/admin/alerts-monitor");
  await expect(secondTab.getByRole("heading", { name: "Alerts" })).toBeVisible();

  await page.bringToFront();
  await page.clock.fastForward(5 * 60 * 1000 + 300);
  await expect(page.getByRole("alertdialog", { name: "Session Expiring" })).toBeVisible();
  await page.clock.fastForward(60 * 1000 + 300);
  await expect.poll(() => logoutCalls).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
  await expect(secondTab).toHaveURL(/\/login$/);
});
