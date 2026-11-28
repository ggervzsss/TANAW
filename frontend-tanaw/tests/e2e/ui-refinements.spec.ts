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
  enterpriseTotal: 1,
  generatedAt: "2026-10-09T08:00:00+08:00",
  updatedAt: "2026-10-09T08:00:00+08:00",
  sources: [{ id: "source-1", enterpriseProfileId: "archie", attractionCode: "799", enterprise: "Archie's Event Place", code: "SAMPLE-REP-2605-01", unique: 377, entry: 598, exit: 571 }],
};

const archivedReport = {
  ...finalReport,
  id: "SAMPLE-FINAL-JUNE-2025-0001",
  period: "June 2025",
  generatedOn: "June 30, 2025",
  status: "Archived",
  sources: [{ ...finalReport.sources[0], enterpriseProfileId: "museum", attractionCode: "205", enterprise: "Riverside Museum" }],
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
  await page.route("**/operational/reports/final", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([finalReport, archivedReport]) }));
  await page.route("**/operational/reports/intake", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/reports/enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/activity-logs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(staffUser.email);
  await page.getByLabel("Password", { exact: true }).fill("UI verification passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/reports$/);
}

test("uses the night topbar, keyboard month filter, and wide report preview", async ({ page }, testInfo) => {
  await signInAsStaff(page);

  const topbar = page.locator('[data-topbar-theme="dark"]');
  await expect(topbar).toBeVisible();
  await expect(page.locator('[style*="it-topbar-building-night.png"]')).toBeVisible();
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "General Settings" }).click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: "Light Mode" }).click();
  await expect(page.locator('[data-topbar-theme="light"]')).toBeVisible();
  await expect(page.locator('[style*="it-topbar-building.png"]')).toBeVisible();
  await page.getByRole("radio", { name: "Dark Mode" }).click();

  await page.goto("/staff/batch-reports");
  await expect(page).toHaveURL(/\/staff\/reports$/);
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate consolidated report" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("staff-reports-dark.png"), animations: "disabled" });

  await page.goto("/staff/final-reports-audit");
  await expect(page).toHaveURL(/\/staff\/consolidated-reports$/);
  await expect(page.getByRole("heading", { name: "Consolidated Reports", exact: true })).toBeVisible();
  const yearDropdown = page.getByRole("combobox", { name: "Year" });
  await expect(yearDropdown).toHaveJSProperty("tagName", "BUTTON");
  await expect(yearDropdown).toContainText("2026");
  const monthly = page.getByRole("table", { name: "Monthly reports for 2026" });
  await expect(monthly.getByText(finalReport.id, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("consolidated-reports-dark.png"), animations: "disabled" });
  await yearDropdown.focus();
  await yearDropdown.press("Enter");
  await expect(page.getByRole("listbox", { name: "Year" })).toBeVisible();
  await yearDropdown.press("Escape");

  await monthly.getByRole("button", { name: `View the ${finalReport.period} report` }).click();
  const viewer = page.getByRole("dialog", { name: "Monthly report (VAR 2M)" });
  await expect(viewer).toBeVisible();
  const var2m = viewer.getByRole("table", { name: "VAR 2M May 2026" });
  await expect(var2m).toBeInViewport({ ratio: 1 });
  await expect(viewer.locator("[data-dialog-body]")).toHaveCSS("background-color", "rgb(16, 25, 35)");
  await page.screenshot({ path: testInfo.outputPath("monthly-report-dark.png"), animations: "disabled" });
  await expect(var2m.getByRole("columnheader", { name: "This Municipality" })).toHaveCSS("background-color", "rgb(255, 255, 0)");
  await expect(var2m.locator("tbody td").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(var2m.locator("tfoot td").last()).toHaveCSS("background-color", "rgb(146, 208, 80)");
  await expect(var2m.locator("tfoot td").last()).toHaveText("377");
  const downloadPromise = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("SAMPLE-FINAL-MAY-2026-0001.pdf");
  await download.saveAs(testInfo.outputPath("official-final-report.pdf"));
  await expect(viewer.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  await expect(page.locator('iframe[title="Report print document"]')).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-print-invoked", "true");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(monthly.getByRole("button", { name: `View the ${finalReport.period} report` })).toBeFocused();
});

test("compiles the finalized months into the annual VAR 3M", async ({ page }, testInfo) => {
  await signInAsStaff(page);
  await page.getByRole("link", { name: "Consolidated Reports" }).click();
  await page.getByRole("tab", { name: "Annual (VAR 3M)" }).click();
  await page.getByRole("button", { name: "View the 2026 annual report" }).click();

  const var3 = page.getByRole("table", { name: "VAR 3M LGU Annual Report 2026" });
  await expect(var3.getByRole("columnheader", { name: "Archie's Event Place - 799" })).toBeVisible();
  await expect(var3.getByRole("rowheader", { name: "May" })).toHaveCSS("background-color", "rgb(255, 255, 0)");
  await expect(var3.getByRole("row", { name: /^May/ })).toContainText("377");
  await expect(page.getByText(/months finalized/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("annual-report-dark.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  const annual = page.getByRole("dialog", { name: "Annual report (VAR 3M)" });
  await expect(annual.getByRole("table")).toHaveCount(2);
  await expect(annual.getByRole("columnheader", { name: "Grand Total Visitors" })).toBeVisible();
  await expect.poll(() => annual.locator("[data-dialog-body]").evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0);
  const download = page.waitForEvent("download");
  await annual.getByRole("button", { name: "Download PDF" }).click();
  expect((await download).suggestedFilename()).toBe("VAR3M-2026.pdf");
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

  // Like every settings form, the save bar appears only once something is typed.
  await expect(page.getByRole("button", { name: "Update password" })).toHaveCount(0);
  await newPassword.fill("Replacement secure passphrase 2026");
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

  await page.goto("/staff/reports");
  await page.goto("/staff/security");
  await expect(page.getByLabel("Current Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("New Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Confirm New Password", { exact: true })).toHaveValue("");
  expect(passwordRequests).toBe(1);
  expect(browserErrors).toEqual([]);
});

test("shows the Sign Out background only while the shared profile action is interactive", async ({ page }) => {
  await signInAsStaff(page);
  await page.getByRole("button", { name: "Open account menu" }).click();
  const logout = page.getByRole("button", { name: "Sign Out" });
  await expect(logout).toBeVisible();
  await expect(logout).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await logout.hover();
  await expect(logout).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.mouse.move(0, 0);
  await expect(logout).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});
