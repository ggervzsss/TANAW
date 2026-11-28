import { expect, test, type Page } from "@playwright/test";

function userFor(role: "it" | "admin" | "staff") {
  return {
    id: `${role}-integration`,
    email: `${role}@example.test`,
    displayName: `${role} Integration`,
    role,
    title: "TANAW Account",
    phone: null,
    firstName: "Integration",
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
}

async function mockPortal(page: Page, role: Parameters<typeof userFor>[0]) {
  const user = userFor(role);
  let preferences = { theme: "dark", textSize: "extra-large" };
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "integration-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => {
    if (route.request().method() === "PATCH") preferences = { ...preferences, ...route.request().postDataJSON() };
    return route.fulfill({ json: preferences });
  });
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  for (const endpoint of ["**/operational/requests", "**/operational/enterprise-health", "**/accounts/enterprises", "**/accounts/lgu", /\/mail\/deliveries(\?.*)?$/]) {
    await page.route(endpoint, (route) => route.fulfill({ json: [] }));
  }
}

for (const { role, path, previousTitle } of [
  { role: "it", path: "/it/requests", previousTitle: "Requests" },
  { role: "admin", path: "/admin/requests", previousTitle: "Requests" },
  { role: "staff", path: "/staff/consolidated-reports", previousTitle: "Consolidated Reports" },
] as const) {
  test(`${role} Settings takes over the portal page and returns to ${previousTitle}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await mockPortal(page, role);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: previousTitle, exact: true })).toBeVisible();

    const trigger = page.getByRole("button", { name: "Open account menu" });
    await trigger.click();
    await page.getByRole("button", { name: "General Settings", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${role}/settings$`));
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("General Settings");
    await expect(main.getByRole("heading", { name: previousTitle, exact: true })).toHaveCount(0);
    const workspace = main.getByRole("region", { name: "General Settings" });
    expect(await workspace.boundingBox()).toEqual(await main.boundingBox());
    const header = workspace.locator(".tanaw-settings-header");
    const back = header.getByRole("button", { name: "Back from General Settings" });
    await expect(header.getByText(userFor(role).email)).toHaveCount(0);
    const profile = workspace.getByRole("region", { name: "Profile Information" });
    await expect(profile.getByRole("heading", { name: userFor(role).displayName })).toBeVisible();
    await expect(profile.getByText(userFor(role).email, { exact: true })).toHaveCount(1);
    await expect(profile.getByRole("button", { name: "Edit email" })).toHaveCount(0);
    // One edit model: fields are always editable and the save bar appears only with unsaved changes.
    await expect(profile.getByRole("button", { name: /^(Edit|Lock) / })).toHaveCount(0);
    await expect(profile.getByLabel("First Name", { exact: true })).toBeEditable();
    await expect(main.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Discard" })).toHaveCount(0);
    // Only the Admin keeps a Requests section; IT handles requests and system settings on their own screens.
    await expect(main.getByRole("button", { name: "Requests", exact: true })).toHaveCount(role === "admin" ? 1 : 0);
    await expect(main.getByRole("button", { name: "System Settings" })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Developer Settings" })).toHaveCount(0);
    await expect(workspace).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(back).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(path + "$"));
    await expect(page.getByRole("heading", { name: previousTitle, exact: true })).toBeVisible();
  });
}

test("the whole account menu row responds at either edge in both themes", async ({ page }) => {
  await mockPortal(page, "it");
  await page.goto("/it/settings/appearance");
  const trigger = page.getByRole("button", { name: "Open account menu" });
  const menu = page.locator(".tanaw-account-menu");
  await expect(page.locator(".tanaw-account-control")).toHaveCSS("display", "flex");
  for (const theme of ["Light Mode", "Dark Mode"]) {
    await page.getByRole("radio", { name: theme }).click();
    await trigger.click();
    await expect(menu).toHaveCSS("transform", "none");
    for (const name of ["General Settings", "Help Center", "Sign Out"]) {
      const action = menu.getByRole("button", { name });
      const row = action.locator(".tanaw-account-menu-row");
      const box = (await action.boundingBox())!;
      const activeBackground = await action.evaluate((el) => getComputedStyle(el).backgroundColor);
      for (const inset of [4, box.width - 4]) {
        await action.hover({ position: { x: inset, y: box.height / 2 } });
        await expect(row).toHaveCSS("transform", "matrix(1, 0, 0, 1, 2, 0)");
        if (name !== "General Settings") await expect(action).not.toHaveCSS("background-color", activeBackground);
        expect(await action.boundingBox()).toEqual(box);
      }
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(menu).toBeHidden();
  }
});

test("integrates IT settings and help routes with browser history at enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await mockPortal(page, "it");
  await page.goto("/it/requests");
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await expect(page.getByRole("button", { name: /Switch to .* mode/ })).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "Open account menu" });
  await trigger.press("Enter");
  const menu = page.locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
  await expect(menu.getByRole("button")).toHaveText(["General Settings", "Help Center", "Sign Out"]);
  const box = await menu.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(361);
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "General Settings" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByText("All caught up")).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit profile" }).press("Enter");
  await expect(page).toHaveURL(/\/it\/settings\/profile$/);
  await expect(page.getByRole("heading", { name: "Profile Information" })).toBeVisible();
  await expect.poll(() => page.locator(".tanaw-settings-panel").evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("button", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "System Settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Requests", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/it\/requests$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/it\/settings\/profile$/);
  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page.getByRole("heading", { name: "Display Preferences" })).toBeVisible();
  await page.getByRole("radio", { name: "Light Mode" }).click();
  await expect(page.locator("[data-topbar-theme]")).toHaveAttribute("data-topbar-theme", "light");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Light Mode" })).toBeChecked();
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("radio", { name: "System Default" }).click();
  await expect(page.getByRole("radio", { name: "System Default" })).toBeChecked();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("[data-topbar-theme]")).toHaveAttribute("data-topbar-theme", "dark");
  await page.getByRole("button", { name: "Back from General Settings" }).click();
  await expect(page).toHaveURL(/\/it\/requests$/);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Help Center" }).click();
  await expect(page).toHaveURL(/\/it\/help$/);
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("restricts Admin settings and saves profile changes through the existing API", async ({ page }) => {
  await mockPortal(page, "admin");
  await page.route("**/auth/profile", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ firstName: "Updated", lastName: "User" });
    return route.fulfill({ json: { ...userFor("admin"), firstName: "Updated", displayName: "Updated User" } });
  });
  await page.goto("/admin/settings/system");
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("button", { name: "System Settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Developer Settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Requests", exact: true })).toBeVisible();
  const branding = page.locator("[data-portal-role-label]").locator("..");
  await expect(branding.getByRole("link")).toHaveCount(0);
  await expect(branding.getByRole("button")).toHaveCount(0);
  await branding.getByText("TANAW", { exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  const save = page.getByRole("button", { name: "Save changes" });
  const discardChanges = page.getByRole("button", { name: "Discard", exact: true });
  await expect(save).toHaveCount(0);
  await page.getByLabel("First Name", { exact: true }).fill("Discarded");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  await expect(save).toBeInViewport();
  await expect(discardChanges).toBeInViewport();
  await page.getByRole("button", { name: "Back from General Settings" }).click();
  const discard = page.getByRole("dialog", { name: "Discard unsaved settings?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("First Name", { exact: true })).toHaveValue("Discarded");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  const signOut = page.getByRole("dialog", { name: "Sign out and discard changes?" });
  await expect(signOut).toBeVisible();
  await signOut.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("First Name", { exact: true })).toHaveValue("Discarded");
  await discardChanges.click();
  await expect(page.getByLabel("First Name", { exact: true })).toHaveValue("Integration");
  await expect(save).toHaveCount(0);
  await expect(page.getByLabel("First Name", { exact: true })).toBeFocused();
  await page.getByLabel("First Name", { exact: true }).fill("");
  await save.click();
  await expect(page.getByLabel("First Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("First Name", { exact: true }).fill("Updated");
  await save.click();
  await expect(page.getByText("Profile updated.")).toBeVisible();
  await expect(save).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open account menu" })).toHaveText(/Updated User/);
  await page.getByRole("button", { name: "Requests", exact: true }).click();
  await expect(page.getByText("Requests people sent to IT, with their conversations and status.", { exact: true })).toBeVisible();
});
