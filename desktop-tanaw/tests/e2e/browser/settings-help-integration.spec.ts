import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";

const user = {
  id: "enterprise-integration",
  name: "Integration Enterprise",
  displayName: "Integration Enterprise",
  email: "integration@example.test",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "integration@tanaw.sanpedro",
  enterpriseName: "Integration Enterprise",
  buildingCapacity: 100,
  displayImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2sAAAAASUVORK5CYII=",
};

async function mockEnterprise(page: Page) {
  await page.addInitScript(
    (session) => {
      window.localStorage.setItem("tanaw-auth-session-remember", "true");
      if (!window.localStorage.getItem("tanaw-enterprise-theme")) window.localStorage.setItem("tanaw-enterprise-theme", "dark");
      window.tanawAuthSession = { load: async () => session, save: async () => true, clear: async () => undefined };
    },
    { token: "integration-token", user },
  );
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "integration-token", user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/profile/display-image", (route) => {
    expect(route.request().postDataJSON()).toEqual({ displayImageDataUrl: null });
    return route.fulfill({ json: { ...user, displayImageDataUrl: null } });
  });
  await page.route("**/auth/preferences", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "dark", textSize: "extra-large", interfaceScale: "comfortable" }) }),
  );
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await mockMlRequest(page, "*", () => mlResponse({ status: 503, body: JSON.stringify({ detail: "Unavailable in integration test" }) }));
}

test("integrates Enterprise display and Help Center navigation at practical window sizes", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await mockEnterprise(page);
  await page.goto("/#/enterprise/dashboard");
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await expect(page.getByRole("button", { name: /Switch to .* mode/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("button", { name: "View all notifications" })).toBeVisible();
  await page.keyboard.press("Escape");
  const trigger = page.getByRole("button", { name: "Open account menu" });
  await trigger.click();
  const menu = page.locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
  await expect(menu.getByRole("button")).toHaveText(["General Settings", "Help Center", "Sign Out"]);
  await menu.getByRole("button", { name: "General Settings" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/settings$/);
  await expect(page.getByRole("heading", { name: "Profile Information" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Support Tickets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Developer Settings" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/settings\/profile$/);
  await page.setViewportSize({ width: 1440, height: 760 });
  const main = page.getByRole("main");
  const workspace = main.getByRole("region", { name: "General Settings" });
  await expect(workspace.getByRole("heading", { level: 1 })).toHaveText("General Settings");
  expect(await workspace.boundingBox()).toEqual(await main.boundingBox());
  const panel = page.getByRole("region", { name: "Profile Information" });
  await expect(workspace.locator(".tanaw-settings-header").getByText(user.email)).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: user.enterpriseName })).toBeVisible();
  await expect(panel.getByText(user.email, { exact: true })).toHaveCount(1);
  await panel.getByRole("button", { name: "Edit email", exact: true }).click();
  const emailEditor = page.getByRole("dialog", { name: "Change Business Email" });
  await expect(emailEditor).toBeVisible();
  await emailEditor.getByRole("button", { name: "Close profile edit modal" }).click();
  const save = page.getByRole("button", { name: "Save Changes", exact: true });
  await expect(save).toBeDisabled();
  await expect(save).toBeInViewport();
  await panel.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(save).toBeInViewport();
  await expect(panel.getByText("Enterprise ID", { exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 800, height: 600 });
  await page.getByLabel("Upload establishment logo", { exact: true }).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(page.getByText("Upload a PNG, JPG, or WebP image.")).toBeVisible();
  await page.getByRole("button", { name: "Remove logo" }).click();
  await page.getByRole("button", { name: "Back from General Settings" }).click();
  const discard = page.getByRole("dialog", { name: "Discard unsaved settings?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/settings\/profile$/);
  await page.getByRole("button", { name: "Appearance" }).click();
  await discard.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/settings\/appearance$/);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Remove logo" }).click();
  await save.click();
  await expect(page.getByText("Profile logo saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit profile.*IE/ })).toBeVisible();
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
  await page.getByRole("button", { name: "Developer Settings" }).click();
  await expect(page.getByRole("heading", { name: "Performance profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Camera preview" })).toBeVisible();
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Help Center" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/help$/);
  await expect(page.getByRole("searchbox", { name: "Search help articles" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
