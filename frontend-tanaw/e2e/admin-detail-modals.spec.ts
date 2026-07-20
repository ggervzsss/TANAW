import { expect, test, type Locator, type Page } from "@playwright/test";

const adminUser = {
  id: "admin-detail-test",
  email: "admin-details@example.test",
  displayName: "LGU Admin",
  role: "admin",
  title: "LGU Admin",
  phone: null,
  firstName: "LGU",
  lastName: "Admin",
  enterpriseId: null,
  enterpriseName: null,
  category: null,
  managerName: null,
  barangay: null,
  address: null,
  buildingCapacity: 100,
  displayImageDataUrl: null,
};

const longActor = "A deliberately long administrator display name that must remain safely contained inside its detail card without overlapping adjacent content";
const longSummary = "This deliberately long summary verifies that the balanced detail layout remains readable, wraps safely, and exposes an accessible disclosure only when the value exceeds the configured display threshold.";
const log = {
  id: "LOG-LAYOUT-0001",
  timestamp: "2026-07-18T10:00:00Z",
  category: "Admin Operation",
  severity: "Success",
  actor: longActor,
  actorRole: "Admin",
  action: "Update Profile",
  target: "admin-details@example.test",
  summary: longSummary,
  sourceId: "source-admin-detail-test",
  metadata: {},
};

const alert = {
  id: "ALT-LAYOUT-0001",
  type: "Maintenance Request",
  severity: "Warning",
  enterprise: "A deliberately long enterprise name used to verify the expandable detail treatment without breaking the two-column layout",
  requester: "Enterprise Requester",
  summary: longSummary,
  requiredAction: "Review cloud synchronization, confirm the affected camera nodes, retry the failed telemetry sync, and document the resulting operational status for IT follow-up.",
  resolutionMode: "Remote Review",
  status: "New",
  owner: "Admin",
  time: "2026-07-18T00:15:13Z",
};

async function restoreAdminSession(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("tanaw-web-theme", "dark"));
  await page.route("**/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "admin-detail-token", user: adminUser }) }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(adminUser) }));
  await page.route("**/auth/preferences", (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme: "dark" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/activity-logs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([log]) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([alert]) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

async function expectSameRow(left: Locator, right: Locator) {
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  expect(leftBox).not.toBeNull();
  expect(rightBox).not.toBeNull();
  expect(Math.abs(leftBox!.y - rightBox!.y)).toBeLessThan(2);
}

test("balances Admin log and alert details with accessible long-text disclosures", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await restoreAdminSession(page);

  await page.goto("/admin/system-logs");
  await page.getByText(longActor, { exact: true }).first().click();
  const logDialog = page.getByRole("dialog", { name: "Log Details" });
  await expect(logDialog).toBeVisible();
  await expect(logDialog).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expectSameRow(logDialog.getByText("Target", { exact: true }).locator(".."), logDialog.getByText("Summary", { exact: true }).locator(".."));

  const actorDisclosure = logDialog.getByText("Actor", { exact: true }).locator("..").getByRole("button");
  await expect(actorDisclosure).toHaveAttribute("aria-expanded", "false");
  await actorDisclosure.press("Enter");
  await expect(actorDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(actorDisclosure).toHaveAccessibleName("Show less actor");
  await actorDisclosure.press("Space");
  await expect(actorDisclosure).toHaveAttribute("aria-expanded", "false");
  await expect(logDialog.getByRole("button", { name: "Show more action" })).toHaveCount(0);
  await logDialog.getByRole("button", { name: "Close modal" }).click();

  await page.goto("/admin/alerts-monitor");
  await page.getByText(alert.id, { exact: true }).click();
  const alertDialog = page.getByRole("dialog", { name: "Priority Alert Details" });
  await expect(alertDialog).toBeVisible();
  await expectSameRow(alertDialog.getByText("Enterprise", { exact: true }).locator(".."), alertDialog.getByText("Summary", { exact: true }).locator(".."));
  await expect(alertDialog.getByText("Required Action", { exact: true }).locator("..").locator("..")).toHaveClass(/md:col-span-2/);
  await expect(alertDialog.getByRole("button", { name: "Show more required action" })).toBeVisible();

  await alertDialog.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByText(alert.id, { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Priority Alert Details" })).toHaveCSS("background-color", "rgb(255, 255, 255)");
});
