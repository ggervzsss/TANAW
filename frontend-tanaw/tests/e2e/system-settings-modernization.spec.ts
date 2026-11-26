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
    "monitoring.cameraWaitMinutes": 15,
  };
  const patches: Array<Record<string, string | boolean | number>> = [];
  let failNextPatch = false;

  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "settings-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "light", textSize: "default" }) }),
  );
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

  // The camera wait time saves right away.
  const cameraWait = page.getByRole("combobox", { name: "Camera Wait Time" });
  await expect(cameraWait).toContainText("15 minutes");
  await cameraWait.click();
  await page.getByRole("option", { name: "30 minutes" }).click();
  await expect.poll(() => values["monitoring.cameraWaitMinutes"]).toBe(30);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);

  // A failed save rolls back, and a later successful one keeps the retry.
  failNextPatch = true;
  const timeDisplay = page.getByRole("combobox", { name: "Time Display" });
  await timeDisplay.click();
  await page.getByRole("option", { name: "24-hour" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Failed" })).toBeVisible();
  await expect(timeDisplay).toContainText("12-hour");
  await cameraWait.click();
  await page.getByRole("option", { name: "60 minutes" }).click();
  await expect.poll(() => values["monitoring.cameraWaitMinutes"]).toBe(60);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => values["display.timeFormat"]).toBe("24-hour");

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
