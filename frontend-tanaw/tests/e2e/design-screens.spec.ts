import { expect, test, type Page } from "@playwright/test";

// Design review captures (DESIGN.md at the repository root), tagged @design-capture: `npm run capture:design`
// saves light and dark screenshots of every main web page. Normal test runs exclude them.
const folder = process.env.TANAW_DESIGN_CAPTURE;

type Role = "admin" | "it" | "staff";
type Theme = "light" | "dark";

const telemetrySummary = {
  enterpriseCount: 7,
  onlineGateways: 2,
  delayedGateways: 1,
  offlineGateways: 4,
  totalCurrentOccupancy: 12,
  totalEntries: 677,
  totalExits: 665,
  totalUniqueCount: 457,
  activeReports: 3,
  pendingReports: 3,
  lastSyncAt: "2026-11-17T07:09:00Z",
};

const pages: Record<Role, string[]> = {
  admin: ["dashboard", "enterprises", "reports", "activity", "requests", "notifications", "profile"],
  it: ["dashboard", "work-center", "lgu-accounts", "enterprise-accounts", "system-settings", "system-logs", "security", "display-preferences", "help"],
  staff: ["reports", "consolidated-reports"],
};

function userFor(role: Role) {
  const title = role === "it" ? "IT Personnel" : role === "staff" ? "LGU Staff" : "LGU Admin";
  return {
    id: `${role}-design-review`,
    email: `${role}.design@example.test`,
    displayName: title,
    role,
    title,
    phone: null,
    firstName: "Design",
    lastName: "Review",
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

async function mockPortal(page: Page, role: Role, theme: Theme) {
  const user = userFor(role);
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.addInitScript((value) => window.localStorage.setItem("tanaw-web-theme", value), theme);
  // Registered first so the specific routes below take precedence.
  await page.route(/\/(operational|accounts|activity-logs|reports|system|notifications|help)(\/|\?|$)/, (route) => route.fulfill(json([])));
  await page.route("**/auth/session", (route) => route.fulfill(json({ token: `${role}-design-token`, user })));
  await page.route("**/auth/me", (route) => route.fulfill(json(user)));
  await page.route("**/auth/preferences", (route) => route.fulfill(json(route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme })));
  await page.route("**/operational/telemetry/summary", (route) => route.fulfill(json(telemetrySummary)));
}

test.describe.configure({ timeout: 180_000 });

test("captures the web login page for design review", { tag: "@design-capture" }, async ({ page }) => {
  test.skip(!folder, "Run design captures with npm run capture:design.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((value) => window.localStorage.setItem("tanaw-web-theme", value), theme);
    await page.goto("/login");
    await expect(page.locator("main, form").first()).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${folder}/web-login-${theme}.png` });
  }
});

for (const role of Object.keys(pages) as Role[]) {
  test(`captures ${role} pages for design review`, { tag: "@design-capture" }, async ({ page }) => {
    test.skip(!folder, "Run design captures with npm run capture:design.");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const theme of ["light", "dark"] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockPortal(page, role, theme);
      for (const name of pages[role]) {
        await page.goto(`/${role}/${name}`);
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${folder}/web-${role}-${name}-${theme}.png`, fullPage: true });
      }
    }
  });
}
