import { expect, test } from "@playwright/test";

const staffUser = {
  id: "staff-toast-test",
  email: "staff@example.com",
  displayName: "Toast Test Staff",
  role: "staff",
  title: "LGU Staff",
  phone: null,
  firstName: "Toast",
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

test("loads compiled styles and renders login feedback without CSP violations", async ({ page }) => {
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      cspErrors.push(message.text());
    }
  });
  await page.route("**/auth/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "toast-test-token", user: staffUser }),
    }),
  );
  await page.goto("/login");

  await page.getByLabel("Email", { exact: true }).fill(staffUser.email);
  await page.getByLabel("Password", { exact: true }).fill("Valid login passphrase 2026");
  await page.getByRole("button", { name: "Sign in" }).click();

  const feedback = page.getByRole("status").filter({ hasText: "Login successful" });
  await expect(feedback).toBeVisible();
  // The compiled toast styles: a rounded glass toast holding the message.
  const successToast = page.locator(".tanaw-toast--success").filter({ has: feedback });
  await expect(successToast).toHaveCSS("display", "flex");
  await expect(successToast).toHaveCSS("border-top-left-radius", "16px");
  await expect(successToast.getByRole("button", { name: "Dismiss notification" })).toBeEnabled();
  expect(cspErrors).toEqual([]);
});
