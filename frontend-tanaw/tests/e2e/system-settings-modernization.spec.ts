// IT system settings: the old System Settings addresses open System > Settings, and a failed save
// keeps the edits so they can be saved again. The full Settings form is covered in it-system.spec.ts.
import { expect, test } from "@playwright/test";
import { json, mockEmptyCollections, mockPortalSession, portalUser } from "./support/session";

type SettingValues = Record<string, string | number | boolean>;

const itUser = portalUser("it", { id: "it-settings-user", displayName: "Settings User", firstName: "Settings", lastName: "User" });

test("opens Settings from the old addresses and keeps the edits when a save fails", async ({ page }) => {
  let values: SettingValues = {
    "security.loginAttemptLimit": 5,
    "security.loginLockMinutes": 15,
    "logs.retentionDays": 180,
    "display.dateFormat": "MMM d, yyyy",
    "display.timeFormat": "12-hour",
    "monitoring.cameraWaitMinutes": 15,
  };
  const patches: SettingValues[] = [];
  let failNextPatch = true;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockPortalSession(page, itUser);
  await mockEmptyCollections(page, ["**/operational/notifications", "**/operational/alerts", "**/operational/requests", "**/operational/enterprise-health", "**/accounts/enterprises", "**/accounts/lgu"]);
  await page.route(/\/activity-logs(\?.*)?$/, (route) => route.fulfill(json([])));
  await page.route(/\/activity-logs\/cleanup$/, (route) => route.fulfill(json({ lastRunAt: null, deletedCount: null, retentionDays: 180 })));
  await page.route(/\/mail\/deliveries(\?.*)?$/, (route) => route.fulfill(json([])));
  await page.route("**/auth/system-settings", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = (await route.request().postDataJSON()).values as SettingValues;
      patches.push(patch);
      if (failNextPatch) {
        failNextPatch = false;
        return route.fulfill(json({ detail: "The settings service is unavailable." }, 503));
      }
      values = { ...values, ...patch };
    }
    return route.fulfill(json({ values, updatedBy: itUser.displayName, updatedAt: "2026-09-09T10:00:00Z" }));
  });

  for (const oldPath of ["/it/system-settings", "/it/settings/system"]) {
    await page.goto(oldPath);
    await expect(page).toHaveURL(/\/it\/system\?tab=settings$/);
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  }
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);

  const time = page.getByRole("combobox", { name: "Time", exact: true });
  await time.click();
  await page.getByRole("option", { name: /24-hour/ }).click();
  const cameraWait = page.getByRole("combobox", { name: "Minutes without data before a camera is flagged" });
  await cameraWait.click();
  await page.getByRole("option", { name: "30", exact: true }).click();

  // The first save fails: the edits stay, ready to save again.
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("The settings service is unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
  await expect(time).toContainText("24-hour");
  await expect(cameraWait).toContainText("30");

  await page.getByRole("button", { name: "Save settings" }).click();
  const expected = { "display.timeFormat": "24-hour", "monitoring.cameraWaitMinutes": 30 };
  await expect.poll(() => patches).toEqual([expected, expected]);
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  await expect(time).toContainText("24-hour");
});
