import { expect, test } from "@playwright/test";
import process from "node:process";

const development = process.env.TANAW_E2E_DEV_LOG === "true";

const devLogLink = "http://localhost:5173/activate-account#token=dev-log-link-token";
const itUser = {
  id: "it-dev-log-test",
  email: "it@example.com",
  displayName: "Dev Log Test IT",
  role: "it",
  title: "IT Personnel",
  phone: null,
  firstName: "Dev Log",
  lastName: "Test",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

test(development ? "development shortcut opens Dev Log and copies its link" : "production preview does not expose the Dev Log shortcut or route", async ({ context, page }) => {
  if (development) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "dev-log-test-token", user: itUser }),
    }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(itUser),
    }),
  );
  await page.route("**/auth/preferences", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ theme: "light" }),
    }),
  );
  for (const endpoint of ["**/operational/alerts", "**/operational/notifications", "**/activity-logs"]) {
    await page.route(endpoint, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
  }
  await page.route("**/dev/deliveries", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "delivery-1",
          accountId: itUser.id,
          recipient: "recipient@example.com",
          subject: "Activate your TANAW account",
          body: `Activate your account:\n${devLogLink}\nThis link expires soon.`,
          status: "recorded",
          createdAt: "2026-07-17T00:00:00Z",
        },
      ]),
    }),
  );

  await page.goto("/it/profile");
  await expect(page).toHaveURL(/\/it\/profile$/);
  await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();

  await page.keyboard.type("devlog");

  if (!development) {
    await expect(page).toHaveURL(/\/it\/profile$/);
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Development Email", exact: true })).toHaveCount(0);
    await page.goto("/it/dev-log");
    await expect(page).not.toHaveURL(/\/it\/dev-log$/);
    await expect(page.getByRole("heading", { name: "Development Email", exact: true })).toHaveCount(0);
    return;
  }

  await expect(page).toHaveURL(/\/it\/dev-log$/);
  await expect(page.getByRole("heading", { name: "Development Email", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: devLogLink })).toBeVisible();

  await page.getByRole("button", { name: "Copy link" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Link copied to clipboard" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(devLogLink);
});
