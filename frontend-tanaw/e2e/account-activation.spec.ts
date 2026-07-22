import process from "node:process";
import { expect, test, type Page } from "@playwright/test";

const validToken = "activation-token-with-more-than-twenty-characters";
const validPassword = "Browser activation integration passphrase 2026";

async function mockValidActivation(page: Page, role: "staff" | "enterprise" = "staff") {
  await page.route("**/auth/account-activation/validate", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: validToken });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        displayName: role === "enterprise" ? "Sample Enterprise" : "Sample Staff",
        role,
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    });
  });
}

async function completeActivationForm(page: Page, password = validPassword) {
  await page.getByLabel("New Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Activate Account" }).click();
}

test("reads the fragment token, removes it immediately, and only validates on open", async ({ page }) => {
  let completionRequests = 0;
  await mockValidActivation(page);
  await page.route("**/auth/account-activation/complete", async (route) => {
    completionRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`/activate-account#token=${validToken}`);

  await expect(page.getByText("Welcome, Sample Staff")).toBeVisible();
  await expect(page).toHaveURL(/\/activate-account$/);
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  expect(await page.evaluate(() => document.referrer)).toBe("");
  expect(completionRequests).toBe(0);
});

test("opens a valid activation link in a clean browser without an existing session", async ({ page }) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not authenticated" }),
    }),
  );
  await mockValidActivation(page);

  await page.goto(`/activate-account#token=${validToken}`);

  await expect(page.getByText("Welcome, Sample Staff")).toBeVisible();
  await expect(page).toHaveURL(/\/activate-account$/);
});

test("keeps the password fields, confirmation guidance, requirements, and action in the required order", async ({ page }) => {
  await mockValidActivation(page);
  await page.goto(`/activate-account#token=${validToken}`);

  const order = await page.locator("form").evaluate((form) => {
    const selectors = ["#newPassword", "#confirmPassword", '[aria-label^="Re-enter the new password"]', '[aria-label="Password requirements"]', 'button[type="submit"]'];
    return selectors.map((selector) => Array.from(form.querySelectorAll("input, li, section, button")).indexOf(form.querySelector(selector) as Element));
  });

  expect(order.every((position) => position >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((left, right) => left - right));
  await expect(page.getByLabel("Confirm Password", { exact: true })).toHaveAttribute("aria-describedby", /confirm-password-guidance/);
});

test("shows a specific missing-token state without calling the backend", async ({ page }) => {
  let validationRequests = 0;
  await page.route("**/auth/account-activation/validate", async (route) => {
    validationRequests += 1;
    await route.abort();
  });

  await page.goto("/activate-account");

  await expect(page.getByRole("heading", { name: "Activation link unavailable" })).toBeVisible();
  await expect(page.getByText("This activation link is missing its security token.")).toBeVisible();
  expect(validationRequests).toBe(0);
});

for (const state of ["invalid", "expired", "invalidated", "used"] as const) {
  test(`uses the generic unavailable state for a ${state} activation link`, async ({ page }) => {
    await page.route("**/auth/account-activation/validate", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Activation link is invalid or expired." }),
      });
    });

    await page.goto(`/activate-account#token=${validToken}-${state}`);

    await expect(page.getByRole("heading", { name: "Activation link unavailable" })).toBeVisible();
    await expect(page.getByText("Activation link is invalid or expired.")).toBeVisible();
    await expect(page).toHaveURL(/\/activate-account$/);
  });
}

test("shows password-policy feedback and safe backend activation errors", async ({ page }) => {
  let completionRequests = 0;
  await mockValidActivation(page);
  await page.route("**/auth/account-activation/complete", async (route) => {
    completionRequests += 1;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Activation link is invalid or expired." }),
    });
  });
  await page.goto(`/activate-account#token=${validToken}`);
  await expect(page.getByText("Welcome, Sample Staff")).toBeVisible();

  const lengthRequirement = page.locator("li", {
    hasText: "Between 15 and 128 characters",
  });
  const commonPasswordRequirement = page.locator("li", {
    hasText: "Not a common or easily guessed password",
  });
  await expect(lengthRequirement).toHaveAttribute("data-state", "idle");
  await expect(commonPasswordRequirement).toHaveAttribute("data-state", "idle");

  await page.getByLabel("New Password", { exact: true }).fill("too short");
  await page.getByLabel("Confirm Password", { exact: true }).fill("too short");
  await expect(lengthRequirement).toHaveAttribute("data-state", "unmet");
  await expect(commonPasswordRequirement).toHaveAttribute("data-state", "met");
  await expect(page.locator("li", { hasText: "Passwords match" })).toHaveAttribute("data-state", "met");
  await page.getByRole("button", { name: "Activate Account" }).click();
  await expect(page.getByText("Password must contain at least 15 characters.")).toBeVisible();
  expect(completionRequests).toBe(0);

  await page.getByLabel("New Password", { exact: true }).fill(validPassword);
  await expect(lengthRequirement).toHaveAttribute("data-state", "met");
  await expect(page.locator("li", { hasText: "Passwords do not match" })).toHaveAttribute("data-state", "unmet");
  await page.getByLabel("Confirm Password", { exact: true }).fill(validPassword);
  await expect(page.locator("li", { hasText: "Passwords match" })).toHaveAttribute("data-state", "met");
  await page.getByRole("button", { name: "Activate Account" }).click();
  await expect(page.getByText("Activation link is invalid or expired.")).toBeVisible();
  expect(completionRequests).toBe(1);
});

test("completes LGU activation and navigates to portal sign-in", async ({ page }) => {
  await mockValidActivation(page, "staff");
  await page.route("**/auth/account-activation/complete", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      token: validToken,
      newPassword: validPassword,
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`/activate-account#token=${validToken}`);

  await completeActivationForm(page);

  await expect(page.getByRole("heading", { name: "Account activated" })).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("completes Enterprise activation with browser-to-desktop instructions", async ({ page }) => {
  await mockValidActivation(page, "enterprise");
  await page.route("**/auth/account-activation/complete", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`/activate-account#token=${validToken}`);

  await completeActivationForm(page);

  await expect(page.getByRole("heading", { name: "Account activated" })).toBeVisible();
  await expect(page.getByText(/Return to the TANAW Enterprise desktop application/)).toBeVisible();
  await expect(page.getByText("You may safely close this browser tab.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue to sign in" })).toHaveCount(0);
});

test("activates and signs in an LGU account through a real backend and PostgreSQL", async ({ page, request }) => {
  test.skip(process.env.TANAW_E2E_REAL_BACKEND !== "true", "Set TANAW_E2E_REAL_BACKEND=true with a disposable migrated PostgreSQL backend.");
  const apiUrl = process.env.TANAW_E2E_API_URL;
  const itUsername = process.env.TANAW_E2E_IT_USERNAME;
  const itPassword = process.env.TANAW_E2E_IT_PASSWORD;
  if (!apiUrl || !itUsername || !itPassword) {
    throw new Error("Real E2E requires TANAW_E2E_API_URL and TANAW_E2E_IT_* credentials.");
  }

  const loginResponse = await request.post(`${apiUrl}/auth/login`, {
    data: { username: itUsername, password: itPassword, loginScope: "web" },
  });
  expect(loginResponse.ok()).toBe(true);
  const { token: itToken } = (await loginResponse.json()) as { token: string };
  const email = `tanaw-playwright-${Date.now()}@example.com`;
  const authorization = { Authorization: `Bearer ${itToken}` };
  const creationResponse = await request.post(`${apiUrl}/accounts/lgu`, {
    headers: authorization,
    data: {
      firstName: "Browser",
      lastName: "Activation",
      email,
      phone: "+639123456789",
      role: "staff",
    },
  });
  expect(creationResponse.status()).toBe(201);

  let activationToken = "";
  await expect
    .poll(
      async () => {
        const deliveriesResponse = await request.get(`${apiUrl}/dev/deliveries`, {
          headers: authorization,
        });
        if (!deliveriesResponse.ok()) return "";
        const deliveries = (await deliveriesResponse.json()) as {
          recipient: string;
          body: string;
        }[];
        const delivery = deliveries.find((candidate) => candidate.recipient === email);
        const match = delivery?.body.match(/\/activate-account#token=([A-Za-z0-9_-]+)/);
        activationToken = match?.[1] ?? "";
        return activationToken;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");

  await page.goto(`/activate-account#token=${activationToken}`);
  await expect(page.getByText("Welcome, Browser Activation")).toBeVisible();
  await completeActivationForm(page, "Real browser activation passphrase 2026");
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Real browser activation passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/analytics$/);
});
