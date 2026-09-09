import { expect, test, type Page } from "@playwright/test";

function userFor(role: "admin" | "staff" | "it") {
  return { id: `${role}-help-user`, email: `${role}-help@example.test`, displayName: `${role} Help User`, role, title: "TANAW Account", phone: null, firstName: "Help", lastName: "User", enterpriseId: null, enterpriseName: null, category: null, managerName: null, barangay: null, address: null, buildingCapacity: 100, displayImageDataUrl: null };
}

async function mockPortal(page: Page, role: "admin" | "staff" | "it") {
  const user = userFor(role);
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: `${role}-token`, user }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/auth/preferences", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme: "light", textSize: "default", interfaceScale: "default" }) }));
  await page.route("**/auth/system-settings", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ values: {} }) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

test("filters Staff guidance and supports title, keyword, content, empty, article, and related flows", async ({ page }) => {
  await mockPortal(page, "staff");
  await page.goto("/staff/help");
  await expect(page.getByRole("heading", { name: "Help Center" })).toBeVisible();
  await expect(page.getByText("Submit reports for a reporting period")).toBeVisible();
  await expect(page.getByText("Navigate enterprises on the city map")).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Search help articles" });
  await search.focus();
  await search.fill("returned report");
  await expect(page.getByText("Resolve a returned report")).toBeVisible();
  await search.fill("reviewer feedback");
  await expect(page.getByText("Resolve a returned report")).toBeVisible();
  await search.fill("quantum pineapple");
  await expect(page.getByText("No help articles found")).toBeVisible();
  await page.getByRole("button", { name: "Clear help search" }).click();

  await page.getByText("Submit reports for a reporting period").click();
  await expect(page).toHaveURL(/\/staff\/help\/staff-submit-reports$/);
  await expect(page.getByRole("heading", { name: "Before submitting" })).toBeVisible();
  await page.getByText("Resolve a returned report").click();
  await expect(page).toHaveURL(/\/staff\/help\/staff-returned-reports$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/staff\/help\/staff-submit-reports$/);
});

test("offers the existing Support Tickets path from Admin help", async ({ page }) => {
  await mockPortal(page, "admin");
  await page.goto("/admin/help/admin-operations-center");
  await expect(page.getByRole("heading", { name: "Investigate an issue in Operations Center" })).toBeVisible();
  await page.getByRole("link", { name: "Open Support Tickets" }).click();
  await expect(page).toHaveURL(/\/admin\/operations\?view=support$/);
});
