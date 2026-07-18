import { expect, test, type Page } from "@playwright/test";

const staffUser = {
  id: "staff-ui-test",
  email: "staff-ui@example.test",
  displayName: "LGU Staff",
  role: "staff",
  title: "LGU Staff",
  phone: null,
  firstName: "LGU",
  lastName: "Staff",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

const finalReport = {
  id: "CON-MAY-2026-0001",
  title: "Citywide Tourism Aggregation",
  period: "May 2026",
  generatedOn: "May 31, 2026",
  preparedBy: "Carla Mendoza",
  preparedRole: "Staff Processing Division",
  status: "Finalized",
  totalEntry: 598,
  totalExit: 571,
  totalUnique: 377,
  enterpriseCount: 1,
  sources: [{ id: "source-1", enterprise: "Archie's Event Place", code: "REP-260501", unique: 377, entry: 598, exit: 571 }],
};

async function signInAsStaff(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.route("**/auth/login", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "ui-test-token", user: staffUser }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staffUser) }));
  await page.route("**/auth/preferences", async (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme: "dark" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/operational/reports/final", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([finalReport]) }));
  await page.route("**/operational/reports/intake", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/reports/enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/activity-logs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(staffUser.email);
  await page.getByLabel("Password", { exact: true }).fill("UI verification passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/analytics$/);
}

test("uses the night topbar, keyboard custom dropdown, and maximized report viewer", async ({ page }) => {
  await signInAsStaff(page);

  const topbar = page.locator('[data-topbar-theme="dark"]');
  await expect(topbar).toBeVisible();
  await expect(page.locator('[style*="it-topbar-building-night.png"]')).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator('[data-topbar-theme="light"]')).toBeVisible();
  await expect(page.locator('[style*="it-topbar-building.png"]')).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();

  await page.goto("/staff/final-reports-audit");
  const monthDropdown = page.getByRole("combobox", { name: "Report month" });
  await expect(monthDropdown).toHaveJSProperty("tagName", "BUTTON");
  await monthDropdown.focus();
  await monthDropdown.press("Enter");
  await expect(page.getByRole("listbox", { name: "Report month" })).toBeVisible();
  await monthDropdown.press("End");
  await monthDropdown.press("Enter");
  await expect(monthDropdown).toContainText("May");

  await page.getByText("Citywide Tourism Aggregation", { exact: true }).click();
  const viewer = page.getByRole("dialog", { name: /official artifact viewer/ });
  await expect(viewer).toBeVisible();
  const fullscreen = page.getByRole("button", { name: "Open fullscreen report view" });
  await fullscreen.click();
  await expect(viewer).toHaveClass(/max-w-none/);
  await expect(page.getByRole("button", { name: "Exit fullscreen report view" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(viewer).not.toHaveClass(/max-w-none/);
  await expect(page.getByRole("button", { name: "Open fullscreen report view" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});
