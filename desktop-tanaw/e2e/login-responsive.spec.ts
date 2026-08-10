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

test("loads the original TANAW typefaces from bundled assets", async ({ page }) => {
  const requestedFontUrls: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") requestedFontUrls.push(request.url());
  });

  await page.goto("/#/login");

  const typography = await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 16px "Inter"', "TANAW"), document.fonts.load('500 16px "Montserrat"', "TANAW"), document.fonts.load('600 16px "Bai Jamjuree"', "TANAW")]);

    const stage = document.querySelector<HTMLElement>(".tanaw-auth-stage");
    const heading = document.querySelector<HTMLElement>(".tanaw-auth-brand-title");
    return {
      baiJamjureeLoaded: document.fonts.check('600 16px "Bai Jamjuree"', "TANAW"),
      headingFamily: heading ? window.getComputedStyle(heading).fontFamily : "",
      interLoaded: document.fonts.check('400 16px "Inter"', "TANAW"),
      montserratLoaded: document.fonts.check('500 16px "Montserrat"', "TANAW"),
      stageFamily: stage ? window.getComputedStyle(stage).fontFamily : "",
    };
  });

  expect(typography).toMatchObject({ baiJamjureeLoaded: true, interLoaded: true, montserratLoaded: true });
  expect(typography.headingFamily).toContain("Bai Jamjuree");
  expect(typography.stageFamily).toContain("Inter");
  expect(requestedFontUrls.length).toBeGreaterThanOrEqual(3);
  expect(requestedFontUrls.every((url) => new URL(url).pathname.startsWith("/fonts/"))).toBe(true);
});

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
    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
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

test("prepares both Enterprise login backgrounds before revealing the renderer", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tanaw-enterprise-theme", "dark");
    window.tanawStartup = {
      ready: () => {
        const stage = document.querySelector<HTMLElement>("[data-auth-background-ready]");
        const images = Array.from(document.querySelectorAll<HTMLImageElement>("[data-auth-background-theme]"));
        window.sessionStorage.setItem(
          "tanaw-e2e-renderer-ready",
          JSON.stringify({
            backgroundReady: stage?.dataset.authBackgroundReady === "true",
            imagesReady: images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0),
          }),
        );
      },
    };
  });
  await page.goto("/#/login");

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
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.sessionStorage.getItem("tanaw-e2e-renderer-ready");
        return value ? (JSON.parse(value) as { backgroundReady: boolean; imagesReady: boolean }) : null;
      }),
    )
    .toEqual({ backgroundReady: true, imagesReady: true });

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

test("keeps the Enterprise Swarm Cursor isolated from authentication controls", async ({ page }) => {
  let signedIn = false;
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "swarm-cleanup-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: signedIn ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(signedIn ? { token: "swarm-cleanup-token", user: enterpriseUser } : { detail: "Not authenticated" }),
    }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(enterpriseUser) }));
  await page.goto("/#/login");

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

  const identifier = page.getByPlaceholder("Enter username or registered email");
  const password = page.getByPlaceholder("Enter your password");
  await identifier.fill("enterprise@example.com");
  await password.fill("Interactive Enterprise password 2026");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("checkbox", { name: "Remember me" }).check();
  await page.getByRole("button", { name: /Switch to (?:light|dark) mode/ }).click();
  await page.getByRole("button", { name: "Contact support" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  const box = await swarm.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.35, box!.y + box!.height * 0.45);
  await expect(swarm).toHaveAttribute("data-swarm-interaction", "scatter");
  await expect(identifier).toHaveValue("enterprise@example.com");

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
  await expect(swarm).toHaveCount(0);
  await expect(page.locator(".swarm-cursor__canvas")).toHaveCount(0);
});

test("disables active Enterprise Swarm motion for reduced-motion users", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/login");
  await expect(page.locator("[data-swarm-cursor='true']")).toHaveCount(1);
  await expect(page.locator(".swarm-cursor__canvas")).toHaveCount(0);
  await page.getByPlaceholder("Enter username or registered email").fill("enterprise@example.com");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("keeps Enterprise authentication usable when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
  });
  await page.goto("/#/login");
  await expect(page.locator("[data-swarm-state='unavailable']")).toHaveCount(1);
  await expect(page.locator(".swarm-cursor__canvas")).toHaveCount(0);
  await page.getByPlaceholder("Enter username or registered email").fill("enterprise@example.com");
  await page.getByPlaceholder("Enter your password").fill("Authentication remains available 2026");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
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
