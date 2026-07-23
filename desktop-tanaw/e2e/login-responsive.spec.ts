import { expect, test } from "@playwright/test";

const enterpriseUser = {
  id: "enterprise-brand-test",
  name: "Sample Enterprise",
  displayName: "Sample Enterprise",
  email: "enterprise@example.com",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "sample_enterprise@tanaw.sanpedro",
  enterpriseName: "Sample Enterprise",
  buildingCapacity: 100,
};

const electronViewports = [
  { width: 800, height: 500 },
  { width: 1100, height: 720 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

test("keeps the Enterprise card usable at supported Electron window sizes", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-enterprise-theme", "dark"));

  for (const viewport of electronViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/#/login");

    const card = page.locator(".tanaw-auth-card");
    const box = await card.boundingBox();

    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(500);
    expect(box!.width).toBeLessThanOrEqual(582);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole("heading", { name: "TANAW PORTAL" })).toBeVisible();
    const heroHeading = page.getByRole("heading", { name: "Enterprise Portal", includeHidden: true });
    if (viewport.width <= 960) {
      await expect(heroHeading).toBeHidden();
    } else {
      await expect(heroHeading).toBeVisible();
    }
  }
});

test("keeps typed Enterprise credentials on the dark auth surface", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-enterprise-theme", "dark"));
  await page.goto("/#/login");

  const identifier = page.getByPlaceholder("Enter username or registered email");
  const password = page.getByPlaceholder("Enter your password");
  const identifierShell = identifier.locator("..");

  await identifier.fill("enterprise@example.com");
  await expect(identifierShell).toHaveAttribute("data-state", "valid");
  await identifier.focus();
  await expect(identifierShell).toHaveCSS("background-color", "rgb(16, 30, 50)");
  await expect(identifier).toHaveCSS("caret-color", "rgb(52, 211, 153)");

  await password.fill("A readable Enterprise passphrase");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(identifierShell).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("keeps the theme through Enterprise authentication and renders the Portal label as static text", async ({ page }) => {
  let signedIn = false;
  await page.addInitScript(() => window.localStorage.setItem("tanaw-enterprise-theme", "dark"));
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "enterprise-brand-token", user: enterpriseUser }),
    });
  });
  await page.route("**/auth/session", (route) => {
    if (!signedIn) {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Not authenticated" }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "enterprise-brand-token", user: enterpriseUser }),
    });
  });
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(enterpriseUser),
    }),
  );
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(enterpriseUser.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise login passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => window.localStorage.getItem("tanaw-enterprise-theme"))).toBe("dark");

  await page.reload();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
  await expect(page.locator("html")).toHaveClass(/dark/);

  const roleLabel = page.locator("[data-portal-role-label]", { hasText: "Enterprise Portal" });
  await expect(roleLabel).toBeVisible();
  expect(
    await roleLabel.evaluate((element) => ({
      tagName: element.tagName,
      insideInteractiveControl: Boolean(element.closest("a, button")),
      tabIndex: (element as HTMLElement).tabIndex,
    })),
  ).toEqual({ tagName: "SPAN", insideInteractiveControl: false, tabIndex: -1 });
});
