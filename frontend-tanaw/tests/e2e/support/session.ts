import type { Page } from "@playwright/test";
import type { components } from "../../../src/contracts/generated/api";

/** The signed-in user the backend returns, typed from the generated API contract. */
export type PortalUser = components["schemas"]["AuthUser"];
export type PortalRole = "admin" | "it" | "staff";
export type PortalTheme = "dark" | "light" | "system";

const roleTitles: Record<PortalRole, string> = { admin: "LGU Admin", it: "IT Personnel", staff: "LGU Staff" };

/** A JSON route response. */
export const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/** A portal account with every optional enterprise field cleared; override what a test cares about. */
export function portalUser(role: PortalRole, overrides: Partial<PortalUser> = {}): PortalUser {
  const title = roleTitles[role];
  return {
    id: `${role}-e2e`,
    email: `${role}.e2e@example.test`,
    displayName: title,
    role,
    title,
    phone: null,
    firstName: "Portal",
    lastName: "Tester",
    enterpriseId: null,
    enterpriseName: null,
    category: null,
    managerName: null,
    barangay: null,
    address: null,
    buildingCapacity: 100,
    displayImageDataUrl: null,
    ...overrides,
  };
}

/**
 * Mocks the session endpoints for `user`. With `signedIn: false` the session starts anonymous and
 * becomes signed in once the page posts to /auth/login, so the real sign-in form can be used.
 */
export async function mockPortalSession(page: Page, user: PortalUser, options: { theme?: PortalTheme; signedIn?: boolean; token?: string } = {}) {
  const theme = options.theme ?? "light";
  const token = options.token ?? `${user.role}-e2e-token`;
  let signedIn = options.signedIn ?? true;
  await page.addInitScript((initialTheme) => {
    if (!window.localStorage.getItem("tanaw-web-theme")) window.localStorage.setItem("tanaw-web-theme", initialTheme);
  }, theme);
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill(json({ token, user }));
  });
  await page.route("**/auth/session", (route) => route.fulfill(signedIn ? json({ token, user }) : json({ detail: "Not authenticated" }, 401)));
  await page.route("**/auth/me", (route) => route.fulfill(json(user)));
  await page.route("**/auth/preferences", (route) => route.fulfill(json(route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme })));
}

/** Answers each listed collection endpoint with an empty list. */
export async function mockEmptyCollections(page: Page, endpoints: string[]) {
  for (const endpoint of endpoints) await page.route(endpoint, (route) => route.fulfill(json([])));
}

/** Waits until the page has no theme transition or finite animation running, for a stable screenshot. */
export async function waitForStillPage(page: Page) {
  await page.waitForFunction(
    () =>
      !document.documentElement.hasAttribute("data-portal-theme-transition") &&
      document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().endTime === Infinity),
  );
}
