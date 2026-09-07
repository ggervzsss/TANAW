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
  id: "SAMPLE-FINAL-MAY-2026-0001",
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
  sources: [{ id: "source-1", enterprise: "Archie's Event Place", code: "SAMPLE-REP-2605-01", unique: 377, entry: 598, exit: 571 }],
};

async function signInAsStaff(page: Page) {
  let signedIn = false;
  await page.addInitScript(() => {
    window.localStorage.setItem("tanaw-web-theme", "dark");
    window.print = () => document.documentElement.setAttribute("data-print-invoked", "true");
  });
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "ui-test-token", user: staffUser }) });
  });
  await page.route("**/auth/session", (route) => {
    if (!signedIn) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Not authenticated" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "ui-test-token", user: staffUser }) });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staffUser) }));
  await page.route("**/auth/preferences", async (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme: "dark" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/operational/reports/final", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([finalReport]) }));
  await page.route("**/operational/reports/final/*/status", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ status: "Archived" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...finalReport, status: "Archived", archivedFromStatus: "Finalized" }) });
  });
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

test("uses the night topbar, keyboard custom dropdown, and maximized report viewer", async ({ page }, testInfo) => {
  await signInAsStaff(page);

  const topbar = page.locator('[data-topbar-theme="dark"]');
  await expect(topbar).toBeVisible();
  await expect(page.locator('[style*="it-topbar-building-night.png"]')).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator('[data-topbar-theme="light"]')).toBeVisible();
  await expect(page.locator('[style*="it-topbar-building.png"]')).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();

  await page.goto("/staff/final-reports-audit");
  const reportRow = page.getByRole("row", { name: /SAMPLE-FINAL-MAY-2026-0001/ });
  const artifactDisclosure = page.getByRole("button", { name: "Show full artifact ID" });
  await expect(artifactDisclosure).toBeVisible();
  await expect(page.getByRole("button", { name: "Show full report preparer" })).toHaveCount(0);
  await artifactDisclosure.click();
  const collapseArtifactDisclosure = page.getByRole("button", { name: "Collapse full artifact ID" });
  await expect(collapseArtifactDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(collapseArtifactDisclosure).toHaveText("…");
  await collapseArtifactDisclosure.click();
  await reportRow.hover();
  const hoverColor = await reportRow.evaluate((row) => getComputedStyle(row).backgroundColor);
  expect(hoverColor).toMatch(/^rgba?\(27, 48, 47/);

  const monthDropdown = page.getByRole("combobox", { name: "Report month" });
  await expect(monthDropdown).toHaveJSProperty("tagName", "BUTTON");
  await monthDropdown.focus();
  await monthDropdown.press("Enter");
  await expect(page.getByRole("listbox", { name: "Report month" })).toBeVisible();
  await monthDropdown.press("End");
  await monthDropdown.press("Enter");
  await expect(monthDropdown).toContainText("May");

  await reportRow.click();
  const viewer = page.getByRole("dialog", { name: /official artifact viewer/ });
  await expect(viewer).toBeVisible();
  const sourceCells = viewer.locator(".tanaw-official-report-table tbody tr").first().locator("td");
  const ordinaryCellColor = await sourceCells.nth(2).evaluate((cell) => getComputedStyle(cell).backgroundColor);
  await expect(sourceCells.nth(4)).not.toHaveCSS("background-color", ordinaryCellColor);
  await expect(sourceCells.nth(11)).toHaveCSS("background-color", ordinaryCellColor);
  await expect(sourceCells.nth(13)).not.toHaveCSS("background-color", ordinaryCellColor);
  const downloadPromise = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("SAMPLE-FINAL-MAY-2026-0001.pdf");
  await download.saveAs(testInfo.outputPath("official-final-report.pdf"));
  await expect(viewer.getByRole("button", { name: "Print to PDF" })).toHaveCount(0);
  await expect(page.locator('iframe[title="Official report print document"]')).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-print-invoked", "true");
  const fullscreen = page.getByRole("button", { name: "Open fullscreen report view" });
  await fullscreen.click();
  await expect(viewer).toHaveClass(/max-w-none/);
  await expect(page.getByRole("button", { name: "Exit fullscreen report view" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(viewer).not.toHaveClass(/max-w-none/);
  await expect(page.getByRole("button", { name: "Open fullscreen report view" })).toHaveAttribute("aria-pressed", "false");
  await viewer.getByRole("button", { name: "Close final report" }).click();
  await expect(viewer).toBeHidden();

  await reportRow.click();
  await viewer.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Archive Report", exact: true }).click();
  await expect(viewer).toBeHidden();
});

test("keeps Password Settings blank, theme-correct, and resettable", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  let passwordRequests = 0;
  await page.route("**/auth/change-password", async (route) => {
    passwordRequests += 1;
    expect(route.request().postDataJSON()).toEqual({
      currentPassword: "Current secure passphrase 2026",
      newPassword: "Replacement secure passphrase 2026",
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "updated-ui-test-token", user: staffUser }) });
  });
  await signInAsStaff(page);
  await page.goto("/staff/security");

  const currentPassword = page.getByLabel("Current Password", { exact: true });
  const newPassword = page.getByLabel("New Password", { exact: true });
  const confirmation = page.getByLabel("Confirm New Password", { exact: true });
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  await expect(currentPassword).toHaveAttribute("autocomplete", "new-password");
  await expect(newPassword).toHaveAttribute("autocomplete", "new-password");
  await expect(confirmation).toHaveAttribute("autocomplete", "new-password");
  await expect(currentPassword).toHaveAttribute("readonly", "");
  await expect(currentPassword).toHaveAttribute("data-1p-ignore", "true");
  const currentPasswordToggle = page.getByRole("button", { name: "Show current password" });
  await expect(currentPasswordToggle).toBeDisabled();
  await expect(currentPassword).not.toHaveCSS("background-color", "rgb(255, 255, 0)");

  await page.getByRole("button", { name: "Update Password" }).click();
  await expect(currentPassword).toBeFocused();
  await expect(page.getByText("Enter your current password.")).toBeVisible();
  expect(browserErrors).toEqual([]);
  expect(passwordRequests).toBe(0);

  await currentPassword.fill("Current secure passphrase 2026");
  await newPassword.fill("Replacement secure passphrase 2026");
  await confirmation.fill("Mismatched secure passphrase 2026");
  await page.getByRole("button", { name: "Update Password" }).click();
  await expect(page.getByText("New passwords do not match.")).toBeVisible();
  await expect(confirmation).toBeFocused();
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  expect(browserErrors).toEqual([]);
  expect(passwordRequests).toBe(0);

  await currentPassword.focus();
  await expect(currentPassword).not.toHaveAttribute("readonly", "");
  await currentPassword.fill("Current secure passphrase 2026");
  await expect(currentPasswordToggle).toBeEnabled();
  await currentPasswordToggle.click();
  await expect(currentPassword).toHaveAttribute("type", "text");
  await expect(currentPassword).toHaveValue("Current secure passphrase 2026");
  await page.getByRole("button", { name: "Hide current password" }).click();
  await newPassword.fill("Replacement secure passphrase 2026");
  await confirmation.fill("Replacement secure passphrase 2026");
  await page.getByRole("button", { name: "Update Password" }).click();
  await expect(page.getByText("Password updated.")).toBeVisible();
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");

  await page.goto("/staff/analytics");
  await page.goto("/staff/security");
  await expect(page.getByLabel("Current Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("New Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Confirm New Password", { exact: true })).toHaveValue("");
  expect(passwordRequests).toBe(1);
  expect(browserErrors).toEqual([]);
});

test("shows the Logout background only while the shared profile action is interactive", async ({ page }) => {
  await signInAsStaff(page);
  await page.getByRole("button", { name: "Open account menu" }).click();
  const logout = page.getByRole("button", { name: "Logout" });
  await expect(logout).toHaveClass(/profile-menu-danger/);
  await expect(logout).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await logout.hover();
  await expect(logout).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.mouse.move(0, 0);
  await expect(logout).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});
