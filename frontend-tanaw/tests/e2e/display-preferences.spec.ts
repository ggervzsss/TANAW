import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "display-user",
  email: "display@example.test",
  displayName: "Display User",
  role: "it",
  title: "IT Personnel",
  phone: null,
  firstName: "Display",
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

async function mockDisplayAccount(page: Page) {
  let preferences = { theme: "dark", textSize: "default" };
  let failNextPatch = false;
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "display-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      if (failNextPatch) {
        failNextPatch = false;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Offline" }) });
      }
      preferences = { ...preferences, ...(await route.request().postDataJSON()) };
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preferences) });
  });
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  return { failNext: () => (failNextPatch = true), read: () => preferences };
}

test("applies, persists, reloads, resets, and retries account display preferences", async ({ page }) => {
  const account = await mockDisplayAccount(page);
  await page.goto("/it/display-preferences");

  await expect(page.getByRole("heading", { name: "Display Preferences" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "default");
  await expect(page.getByRole("group", { name: "Text size" })).toBeVisible();
  await expect(page.getByText("Interface scale")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Comfortable/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset to default" })).toBeDisabled();
  const preview = page.getByRole("region", { name: "Live preview" });
  await expect(preview).toContainText("Default · 16px text");
  await expect(preview.getByText("Visitor overview")).toHaveCSS("font-family", /Bai Jamjuree/);

  await page.getByRole("radio", { name: /Large Makes text easier/ }).check({ force: true });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  await expect(page.locator("html")).not.toHaveAttribute("data-interface-scale", /.*/);
  await expect(preview).toContainText("Large · 18px text");
  await expect(preview.getByText("Visitor overview")).toHaveCSS("font-size", "20.25px");
  expect(account.read()).toEqual({ textSize: "large", theme: "dark" });

  await page.reload();
  await expect(page.getByRole("radio", { name: /Large Makes text easier/ })).toBeChecked();
  await expect(page.locator("html")).toHaveCSS("font-size", "18px");

  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByRole("radio", { name: /Default TANAW's standard/ })).toBeFocused();
  await expect(page.locator("html")).toHaveCSS("font-size", "16px");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  account.failNext();
  await page.getByRole("radio", { name: /Extra Large Maximizes/ }).check({ force: true });
  await expect(page.getByRole("alert")).toContainText("Failed to save");
  await expect(page.locator("html")).toHaveCSS("font-size", "16px");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
});
