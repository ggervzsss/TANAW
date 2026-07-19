import { expect, test, type Page } from "@playwright/test";

const webPortals = [
  { role: "it", path: "/it/dashboard", label: "IT Portal" },
  { role: "admin", path: "/admin/alerts-monitor", label: "Admin Portal" },
  { role: "staff", path: "/staff/analytics", label: "Staff Portal" },
] as const;

type WebPortalRole = (typeof webPortals)[number]["role"];

function createPortalUser(role: WebPortalRole) {
  return {
    id: `${role}-session-test`,
    email: `${role}-session@example.test`,
    displayName: `Session Test ${role}`,
    role,
    title: "LGU Admin",
    phone: null,
    firstName: "Session",
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
}

async function mockAuthenticatedPortal(page: Page, role: WebPortalRole, onLogout: () => void) {
  const user = createPortalUser(role);
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: `${role}-session-token`, user }) }));
  await page.route("**/auth/logout", (route) => {
    onLogout();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "dark" }) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/activity-logs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

for (const portal of webPortals) {
  test(`keeps a valid ${portal.label} session active without user activity`, async ({ page }) => {
    let logoutCalls = 0;
    await page.clock.install({ time: new Date("2026-07-18T12:00:00Z") });
    await mockAuthenticatedPortal(page, portal.role, () => {
      logoutCalls += 1;
    });
    await page.goto(portal.path);
    await expect(page.locator("[data-portal-role-label]")).toHaveText(portal.label);

    await page.clock.fastForward(10 * 60 * 1000);

    await expect(page.getByRole("alertdialog", { name: "Session Expiring" })).toHaveCount(0);
    await expect(page.getByText("Stay Signed In", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Signing out in", { exact: false })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${portal.path}$`));
    await expect(page.locator("[data-portal-role-label]")).toHaveText(portal.label);
    expect(logoutCalls).toBe(0);

    await page.reload();
    await expect(page.locator("[data-portal-role-label]")).toHaveText(portal.label);
  });
}

test("redirects to login when session restoration is rejected", async ({ page }) => {
  await page.route("**/auth/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Session expired or revoked" }) }));

  await page.goto("/admin/alerts-monitor");

  await expect(page).toHaveURL(/\/login$/);
});

test("synchronizes explicit logout to another browser tab", async ({ context, page }) => {
  let logoutCalls = 0;
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined });
  });
  await mockAuthenticatedPortal(page, "admin", () => {
    logoutCalls += 1;
  });
  await page.goto("/admin/alerts-monitor");
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();

  const secondTab = await context.newPage();
  await mockAuthenticatedPortal(secondTab, "admin", () => undefined);
  await secondTab.goto("/admin/alerts-monitor");
  await expect(secondTab.getByRole("heading", { name: "Alerts" })).toBeVisible();

  await page.bringToFront();
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Logout", exact: true }).click();

  await expect.poll(() => logoutCalls).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
  await expect(secondTab).toHaveURL(/\/login$/);
});
