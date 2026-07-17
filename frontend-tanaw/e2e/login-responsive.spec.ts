import { expect, test } from "@playwright/test";

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
