import { expect, type Page } from "@playwright/test";
import type { components } from "../../../../src/contracts/generated/api";
import { mlResponse, mockMlRequest } from "./preload";

/** The signed-in Enterprise account, typed from the generated API contract. */
/** Enterprise accounts always carry their enterprise identity, which the contract leaves optional. */
export type EnterpriseUser = components["schemas"]["AuthUser"] & { name?: string; enterpriseId: string; enterpriseName: string };

/** A JSON route response. */
export const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

export function enterpriseUser(overrides: Partial<EnterpriseUser> = {}): EnterpriseUser {
  return {
    id: "enterprise-interactions-test",
    name: "Interaction Test Enterprise",
    displayName: "Interaction Test Enterprise",
    email: "enterprise-interactions@example.test",
    role: "enterprise",
    title: "Enterprise Account",
    enterpriseId: "interaction_test@tanaw.sanpedro",
    enterpriseName: "Interaction Test Enterprise",
    buildingCapacity: 100,
    ...overrides,
  };
}

export const defaultEnterpriseUser = enterpriseUser();

/**
 * Signs in through the real login form against mocked session endpoints. The ML service answers
 * only its enterprise context unless `configureMl` registers more specific handlers first.
 */
export async function signIn(page: Page, configureMl?: () => Promise<void>, remember = false, user: EnterpriseUser = defaultEnterpriseUser) {
  let signedIn = false;
  const token = "enterprise-interactions-token";
  await page.addInitScript(() => window.localStorage.setItem("tanaw-enterprise-theme", "dark"));
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill(json({ token, user }));
  });
  await page.route("**/auth/session", (route) => route.fulfill(signedIn ? json({ token, user }) : json({ detail: "Not authenticated" }, 401)));
  await page.route("**/auth/me", (route) => route.fulfill(json(user)));
  await page.route("**/operational/notifications", (route) => route.fulfill(json([])));
  await page.route("**/operational/tickets", (route) => route.fulfill(json([])));
  await mockMlRequest(page, "*", (request) => {
    if (new URL(request.url).pathname === "/context/enterprise") {
      return mlResponse({ status: 200, body: JSON.stringify({ enterprise_id: user.enterpriseId, enterprise_name: user.enterpriseName }) });
    }
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "ML service unavailable in renderer acceptance test" }) });
  });

  await configureMl?.();
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(user.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise interaction password 2026");
  if (remember) await page.getByRole("checkbox", { name: "Remember me" }).check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
}
