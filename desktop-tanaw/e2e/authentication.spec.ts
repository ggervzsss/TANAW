import { expect, test, type Page } from "@playwright/test";

const enterpriseUser = {
  id: "enterprise-account-1",
  name: "Sample Enterprise",
  displayName: "Sample Enterprise",
  email: "enterprise@example.com",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "sample_enterprise@tanaw.sanpedro",
  enterpriseName: "Sample Enterprise",
  buildingCapacity: 100,
};

async function openLogin(page: Page) {
  await page.route("https://upload.wikimedia.org/**", (route) => route.abort());
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "TANAW PORTAL" })).toBeVisible();
}

async function fillLogin(page: Page, identifier: string) {
  await page.getByPlaceholder("Enter username or registered email").fill(identifier);
  await page.getByPlaceholder("Enter your password").fill("Enterprise login passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("pending Enterprise accounts remain on sign-in when the backend rejects authentication", async ({ page }) => {
  await page.route("**/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ loginScope: "enterprise" });
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid username or password." }),
    });
  });
  await openLogin(page);

  await fillLogin(page, enterpriseUser.email);

  await expect(page.getByText("Login failed. Please check your credentials.")).toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);
});

for (const identifier of [enterpriseUser.enterpriseId, enterpriseUser.email]) {
  test(`signs in with the registered ${identifier.includes("@tanaw") ? "Enterprise ID" : "email"}`, async ({ page }) => {
    let submittedIdentifier = "";
    await page.route("**/auth/login", async (route) => {
      const payload = route.request().postDataJSON() as {
        username: string;
        password: string;
        loginScope: string;
      };
      submittedIdentifier = payload.username;
      expect(payload.loginScope).toBe("enterprise");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "enterprise-session-token", user: enterpriseUser }),
      });
    });
    await page.route("**/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(enterpriseUser),
      });
    });
    await openLogin(page);

    await fillLogin(page, identifier);

    await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
    expect(submittedIdentifier).toBe(identifier);
  });
}

test("completes OTP recovery and displays the resend cooldown notice", async ({ page }) => {
  await page.route("**/auth/forgot-password/request", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: enterpriseUser.email });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        challengeId: "challenge-1",
        expiresInMinutes: 10,
        resendAvailableInSeconds: 60,
        message: "A code was already sent. Try again in 60 seconds.",
      }),
    });
  });
  await page.route("**/auth/forgot-password/verify", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      challengeId: "challenge-1",
      code: "123456",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ resetToken: "single-use-reset-token" }),
    });
  });
  await page.route("**/auth/forgot-password/reset", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      challengeId: "challenge-1",
      resetToken: "single-use-reset-token",
      newPassword: "Recovered enterprise passphrase 2026",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
  await openLogin(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Registered email", { exact: true }).fill(enterpriseUser.email);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("A code was already sent. Try again in 60 seconds.")).toBeVisible();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByLabel("New password", { exact: true }).fill("Recovered enterprise passphrase 2026");
  await page.getByLabel("Confirm password", { exact: true }).fill("Recovered enterprise passphrase 2026");
  await page.getByRole("button", { name: "Reset password" }).click();

  await expect(page.getByText("Password updated.")).toBeVisible();
});

test("surfaces expired OTP and recovery-request errors without exposing internals", async ({ page }) => {
  let requestAttempts = 0;
  await page.route("**/auth/forgot-password/request", async (route) => {
    requestAttempts += 1;
    if (requestAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Recovery service is temporarily unavailable." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        challengeId: "expired-challenge",
        expiresInMinutes: 10,
        resendAvailableInSeconds: 0,
        message: "Check your registered inbox if an account matches.",
      }),
    });
  });
  await page.route("**/auth/forgot-password/verify", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid or expired verification code." }),
    });
  });
  await openLogin(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  const emailInput = page.getByLabel("Registered email", { exact: true });
  await emailInput.fill(enterpriseUser.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Recovery service is temporarily unavailable.")).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByText("Invalid or expired verification code.")).toBeVisible();
});

test("keeps activation browser-based and never calls an activation endpoint", async ({ page }) => {
  let activationRequests = 0;
  await page.route("**/auth/account-activation/**", async (route) => {
    activationRequests += 1;
    await route.abort();
  });

  await page.goto("/#/activate-account?token=must-not-enter-electron");

  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("heading", { name: "TANAW PORTAL" })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash.includes("token="))).toBe(false);
  expect(activationRequests).toBe(0);
});

test("returns to sign-in when a previously issued session is rejected", async ({ page }) => {
  await page.route("**/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "now-invalid-session", user: enterpriseUser }),
    });
  });
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid or expired token." }),
    });
  });
  await openLogin(page);

  await fillLogin(page, enterpriseUser.email);

  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("heading", { name: "TANAW PORTAL" })).toBeVisible();
});
