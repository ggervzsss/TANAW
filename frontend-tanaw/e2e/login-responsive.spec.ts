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
  { width: 1280, height: 640 },
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
    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
    await expect(hero).toBeVisible();
  }
});

test("centers every standalone authentication card when it fits", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/auth/account-activation/validate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        displayName: "Responsive Test User",
        role: "staff",
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    }),
  );

  const authPages = [
    { path: "/login", readyText: "TANAW PORTAL" },
    {
      path: "/activate-account#token=activation-token-with-more-than-twenty-characters",
      readyText: "Welcome, Responsive Test User",
    },
    { path: "/verify-email-change", readyText: "Verification link unavailable" },
    { path: "/activate-account", readyText: "Activation link unavailable" },
  ];

  for (const viewport of [
    { width: 1280, height: 640 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const authPage of authPages) {
      await page.goto(authPage.path);
      await expect(page.getByText(authPage.readyText, { exact: false }).first()).toBeVisible();

      const card = page.locator(".tanaw-auth-card");
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(4);
    }
  }
});

test("keeps login recovery and support dialogs centered and scrollable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto("/login");

  for (const dialogTrigger of ["Forgot password?", "Contact support"]) {
    await page.getByRole("button", { name: dialogTrigger }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return box ? Math.abs(box.y + box.height / 2 - 320) : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(2);

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);

    await page.getByRole("button", { name: /Close (password recovery|contact support)/ }).click();
    await expect(dialog).toBeHidden();
  }
});

test("keeps authentication actions reachable on compact mobile viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/login");

  const loginCard = await page.locator(".tanaw-auth-card").boundingBox();
  expect(loginCard).not.toBeNull();
  expect(loginCard!.y).toBeGreaterThanOrEqual(0);
  expect(loginCard!.y + loginCard!.height).toBeLessThanOrEqual(640);
  expect(Math.abs(loginCard!.y + loginCard!.height / 2 - 320)).toBeLessThanOrEqual(4);

  await page.route("**/auth/account-activation/validate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        displayName: "Responsive Test User",
        role: "staff",
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    }),
  );
  await page.goto("/activate-account#token=activation-token-with-more-than-twenty-characters");
  await expect(page.getByText("Welcome, Responsive Test User")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(640);

  const activationAction = page.getByRole("button", { name: "Activate Account" });
  await activationAction.scrollIntoViewIfNeeded();
  await expect(activationAction).toBeVisible();
  const actionBox = await activationAction.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(640);
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

test("prepares complete light and dark login backgrounds before revealing the page", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.goto("/login");

  const stage = page.locator("[data-auth-background-ready]");
  const card = page.locator(".tanaw-auth-card");
  await expect(stage).toHaveAttribute("data-auth-background-ready", "true");
  await expect(card).toBeVisible();
  await expect(page.locator("[data-auth-background-theme]")).toHaveCount(2);
  expect(
    await page.locator("[data-auth-background-theme]").evaluateAll((images) =>
      images.every((image) => {
        const element = image as HTMLImageElement;
        return element.complete && element.naturalWidth > 0 && element.naturalHeight > 0;
      }),
    ),
  ).toBe(true);

  await expect(card).toHaveCSS("transform", "none");
  const before = await card.boundingBox();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("[data-auth-background-theme='light']")).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-auth-background-theme='dark']")).toHaveCSS("opacity", "0");
  const after = await card.boundingBox();
  expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  expect(after?.width).toBeCloseTo(before?.width ?? 0, 0);
  expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);

  await page.reload();
  await expect(stage).toHaveAttribute("data-auth-background-ready", "true");
  await expect(card).toBeVisible();
});

test("keeps every web login card corner rounded in light and dark responsive layouts", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 827 });
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "light"));
  await page.goto("/login");

  const card = page.locator(".tanaw-auth-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS("overflow", "hidden");
  const assertUniformCorners = async () => {
    const radii = await card.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    });
    expect(new Set(radii).size).toBe(1);
    expect(Number.parseFloat(radii[0])).toBeGreaterThanOrEqual(24);
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThan(0);
    expect(box!.x + box!.width).toBeLessThan(page.viewportSize()!.width);
  };

  await assertUniformCorners();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await assertUniformCorners();
  await page.setViewportSize({ width: 1280, height: 720 });
  await assertUniformCorners();
});

test("keeps the Swarm Cursor isolated from shared login interactions", async ({ page }) => {
  await page.goto("/login");

  const swarm = page.locator("[data-swarm-cursor='true']");
  await expect(swarm).toHaveCount(1);
  await expect(swarm).toHaveAttribute("data-swarm-visual", "firefly");
  await expect(swarm).toHaveAttribute("data-swarm-algorithm", "reactbits-noise-field");
  await expect(swarm).toHaveAttribute("data-swarm-count", "8");
  await expect(swarm).toHaveAttribute("data-swarm-size", "5");
  await expect(swarm).toHaveAttribute("data-swarm-radius-scale", "2.1");
  await expect(swarm).toHaveAttribute("data-swarm-speed", "2.5");
  await expect(swarm).toHaveAttribute("data-swarm-trail", "0.75");
  await expect(page.locator(".tanaw-stage-glow")).toHaveCount(0);
  await expect.poll(() => page.locator(".swarm-cursor__canvas").count()).toBeLessThanOrEqual(1);

  const previewBox = await swarm.boundingBox();
  expect(previewBox).not.toBeNull();
  await page.mouse.move(previewBox!.x + previewBox!.width * 0.35, previewBox!.y + previewBox!.height * 0.45);
  await page.waitForTimeout(500);

  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  await email.fill("admin@example.com");
  await password.fill("Interactive password 2026");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("checkbox", { name: "Remember me" }).check();
  await page.getByRole("button", { name: /Switch to (?:light|dark) mode/ }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close password recovery" }).click();

  const box = await swarm.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.35, box!.y + box!.height * 0.45);
  await expect(swarm).toHaveAttribute("data-swarm-interaction", "scatter");
  await expect(email).toHaveValue("admin@example.com");

  await page.goto("/activate-account");
  await expect(swarm).toHaveCount(0);
  await expect(page.locator(".swarm-cursor__canvas")).toHaveCount(0);
});

test("disables active Swarm motion for reduced-motion users without hiding login", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await expect(page.locator("[data-swarm-cursor='true']")).toHaveCount(1);
  await expect(page.locator(".swarm-cursor__canvas")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("staff@example.com");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("keeps shared authentication usable when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
  });
  await page.goto("/login");
  await expect(page.locator("[data-swarm-state='unavailable']")).toHaveCount(1);
  await expect(page.locator(".swarm-cursor__canvas")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("staff@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Authentication remains available 2026");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("keeps an explicit login theme through authentication, reload, and logout", async ({ page }) => {
  let synchronizedTheme = "";
  let signedIn = false;
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "theme-test-token", user: staffUser }),
    });
  });
  await page.route("**/auth/session", (route) => {
    if (!signedIn) {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Not authenticated" }) });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "theme-test-token", user: staffUser }),
    });
  });
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
