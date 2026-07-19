import { expect, test, type Page } from "@playwright/test";

const enterpriseUser = {
  id: "enterprise-session-test",
  name: "Session Test Enterprise",
  displayName: "Session Test Enterprise",
  email: "enterprise-session@example.test",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "session_test@tanaw.sanpedro",
  enterpriseName: "Session Test Enterprise",
  buildingCapacity: 100,
};

async function mockAuthenticatedEnterprise(page: Page, onSessionRestore: () => void, onLogout: () => void) {
  await page.route("**/auth/session", (route) => {
    onSessionRestore();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "enterprise-session-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(enterpriseUser) }));
  await page.route("**/auth/logout", (route) => {
    onLogout();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
  });
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("http://127.0.0.1:8765/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/context/enterprise") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }),
      });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "ML service unavailable in renderer acceptance test" }) });
  });
}

test("keeps a valid Enterprise Desktop session active while idle and restores it after reload", async ({ page }) => {
  let logoutCalls = 0;
  let sessionRestoreCalls = 0;
  await page.clock.install({ time: new Date("2026-07-18T12:00:00Z") });
  await mockAuthenticatedEnterprise(
    page,
    () => {
      sessionRestoreCalls += 1;
    },
    () => {
      logoutCalls += 1;
    },
  );

  await page.goto("/#/enterprise/dashboard");
  await expect(page.locator("[data-portal-role-label]", { hasText: "Enterprise Portal" })).toBeVisible();

  await page.clock.fastForward(10 * 60 * 1000);

  await expect(page.getByRole("alertdialog", { name: "Session Expiring" })).toHaveCount(0);
  await expect(page.getByText("Stay Signed In", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
  expect(logoutCalls).toBe(0);

  await page.reload();
  await expect(page.locator("[data-portal-role-label]", { hasText: "Enterprise Portal" })).toBeVisible();
  await expect.poll(() => sessionRestoreCalls).toBeGreaterThanOrEqual(2);

  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect.poll(() => logoutCalls).toBe(1);
  await expect(page).toHaveURL(/#\/login$/);
});

test("redirects to login when the Enterprise Desktop session cannot be restored", async ({ page }) => {
  await page.route("**/auth/session", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Session expired or revoked" }) }));

  await page.goto("/#/enterprise/dashboard");

  await expect(page).toHaveURL(/#\/login$/);
});
