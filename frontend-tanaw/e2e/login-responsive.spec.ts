import { expect, test } from "@playwright/test";

const staffUser = {
  id: "staff-theme-test",
  email: "staff-theme@example.com",
  displayName: "Theme Test Staff",
  role: "staff",
  title: "LGU Staff",
  phone: null,
  firstName: "Theme",
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

const desktopViewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

test("keeps the shared portal login card controlled across desktop viewports", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));

  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/login");

    const card = page.locator(".tanaw-auth-card");
    const hero = page.getByRole("heading", { name: "Welcome to San Pedro" });
    const box = await card.boundingBox();

    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(550);
    expect(box!.width).toBeLessThanOrEqual(582);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(hero).toBeVisible();
  }
});

test("uses application-controlled login input states in dark and light mode", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.goto("/login");

  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  const emailShell = email.locator("..");

  await expect(emailShell).toHaveAttribute("data-state", "empty");
  await email.fill("admin@example.com");
  await expect(emailShell).toHaveAttribute("data-state", "valid");
  await email.focus();
  await expect(emailShell).toHaveCSS("background-color", "rgb(16, 30, 50)");
  await expect(email).toHaveCSS("caret-color", "rgb(52, 211, 153)");

  await password.fill("A readable portal passphrase");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");

  await email.fill("");
  await password.fill("");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(emailShell).toHaveAttribute("data-state", "invalid");

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.getByLabel("Email", { exact: true }).locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("keeps an explicit login theme through authentication, reload, and logout", async ({ page }) => {
  let synchronizedTheme = "";
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.route("**/auth/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "theme-test-token", user: staffUser }),
    }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(staffUser) }));
  await page.route("**/auth/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as { theme: string };
      synchronizedTheme = payload.theme;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "light" }) });
  });
  await page.route("**/auth/logout", (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto("/login");

  await page.getByLabel("Email", { exact: true }).fill(staffUser.email);
  await page.getByLabel("Password", { exact: true }).fill("Theme continuity passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/staff\/analytics$/);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => synchronizedTheme).toBe("dark");
  expect(await page.evaluate(() => window.localStorage.getItem("tanaw-web-theme"))).toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => window.localStorage.getItem("tanaw-web-theme"))).toBe("dark");
});
