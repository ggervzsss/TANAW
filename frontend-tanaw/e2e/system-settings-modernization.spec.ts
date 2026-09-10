import { expect, test } from "@playwright/test";

const user = {
  id: "it-settings-user",
  email: "settings@example.test",
  displayName: "Settings User",
  role: "it",
  title: "IT Personnel",
  phone: null,
  firstName: "Settings",
  lastName: "User",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

test("persists independent settings, rolls back failures, and confirms security changes", async ({ page }) => {
  let values: Record<string, string | boolean | number> = {
    "security.loginAttemptLimit": 3,
    "security.loginLockMinutes": 5,
    "logs.retentionDays": 180,
    "display.timeFormat": "12-hour",
    "notifications.cameraSessionErrorAlerts": true,
    "notifications.gatewayServiceErrorAlerts": true,
    "notifications.syncDelayAlerts": true,
    "notifications.failedLoginLockoutAlerts": true,
  };
  const patches: Array<Record<string, string | boolean | number>> = [];
  let failNextPatch = false;

  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "settings-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "light", textSize: "default", interfaceScale: "default" }) }));
  await page.route("**/auth/system-settings", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = (await route.request().postDataJSON()).values;
      patches.push(patch);
      if (failNextPatch) {
        failNextPatch = false;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Unavailable" }) });
      }
      values = { ...values, ...patch };
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values, updatedBy: user.displayName, updatedAt: "2026-09-09T10:00:00Z" }) });
  });
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/it/system-settings");
  await expect(page.getByRole("heading", { name: "System Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Changes" })).toHaveCount(0);

  const cameraSwitch = page.getByRole("switch", { name: "Camera Problems" });
  await cameraSwitch.click();
  await expect(cameraSwitch).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => patches.some((patch) => patch["notifications.cameraSessionErrorAlerts"] === false)).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  failNextPatch = true;
  const desktopSwitch = page.getByRole("switch", { name: "Desktop Application Problems" });
  await desktopSwitch.click();
  await expect(page.getByRole("alert").filter({ hasText: "Failed" })).toBeVisible();
  await expect(desktopSwitch).toHaveAttribute("aria-checked", "true");

  // A later successful setting must not erase the failed setting's retry payload.
  const syncSwitch = page.getByRole("switch", { name: "Visitor Data Delays" });
  await syncSwitch.click();
  await expect(syncSwitch).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => values["notifications.syncDelayAlerts"]).toBe(false);

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(desktopSwitch).toHaveAttribute("aria-checked", "false");

  const securitySection = page.getByRole("heading", { name: "Account & Security Settings" }).locator("xpath=../../..");
  await page.getByRole("combobox", { name: "Failed Login Threshold" }).click();
  await page.getByRole("option", { name: "5 attempts" }).click();
  await expect(securitySection.getByText("Unsaved section changes")).toBeVisible();
  const patchCountBeforeApply = patches.length;
  await securitySection.getByRole("button", { name: "Apply section" }).click();
  await expect(page.getByRole("dialog", { name: "Apply Sign-in Protection" })).toBeVisible();
  expect(patches).toHaveLength(patchCountBeforeApply);
  await page.getByRole("button", { name: "Apply to all accounts" }).click();
  await expect.poll(() => values["security.loginAttemptLimit"]).toBe(5);
});
