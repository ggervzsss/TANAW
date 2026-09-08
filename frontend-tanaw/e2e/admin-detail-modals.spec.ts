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
const longSummary =
  "This deliberately long summary verifies that the balanced detail layout remains readable, wraps safely, and exposes an accessible disclosure only when the value exceeds the configured display threshold.";
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
  await page.route("**/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "admin-detail-token", user: adminUser }) }));
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(adminUser) }));
  await page.route("**/auth/preferences", (route) => {
    const body = route.request().method() === "PATCH" ? route.request().postDataJSON() : { theme: "dark" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/activity-logs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([log]) }));
  await page.route("**/operational/alerts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([alert]) }));
  await page.route("**/accounts/enterprises", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/tickets", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

async function expectSameRow(left: Locator, right: Locator) {
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  const dialog = left.locator("xpath=ancestor::*[@role='dialog']");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transform", "none");
  const rightElement = await right.elementHandle();
  if (!rightElement) throw new Error("Right detail card is missing");
  // Read both boxes in one browser frame, after the modal's entrance settles.
  const difference = await left.evaluate((element, other) =>
    Math.abs(element.getBoundingClientRect().y - other.getBoundingClientRect().y), rightElement);
  expect(difference).toBeLessThan(2);
}

async function expectTitleSizedAccent(dialog: Locator, title: string) {
  await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
  const boxes = await dialog.locator("[data-modal-title-accent]").evaluate((accent) => {
    const titleWrapper = accent.parentElement;
    if (!titleWrapper) throw new Error("Modal title wrapper is missing.");
    const accentBox = accent.getBoundingClientRect();
    const titleWrapperBox = titleWrapper.getBoundingClientRect();
    return {
      accent: { width: accentBox.width, x: accentBox.x },
      titleWrapper: { width: titleWrapperBox.width, x: titleWrapperBox.x },
    };
  });
  expect(boxes.accent.x).toBeCloseTo(boxes.titleWrapper.x, 0);
  expect(boxes.accent.width).toBeCloseTo(boxes.titleWrapper.width, 0);
  return boxes.accent.width;
}

test("balances Admin log and alert details with accessible long-text disclosures", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await restoreAdminSession(page);

  await page.goto("/admin/activity-history");
  await page.getByText(longActor, { exact: true }).first().click();
  const logDialog = page.getByRole("dialog", { name: "Activity Details" });
  await expect(logDialog).toBeVisible();
  await expect(logDialog).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  const activityAccentWidth = await expectTitleSizedAccent(logDialog, "Activity Details");
  await expectSameRow(logDialog.getByText("Affected Item", { exact: true }).locator(".."), logDialog.getByText("Details", { exact: true }).locator(".."));

  const actorDisclosure = logDialog.getByText("Performed By", { exact: true }).locator("..").getByRole("button");
  await expect(actorDisclosure).toHaveAttribute("aria-expanded", "false");
  await actorDisclosure.press("Enter");
  await expect(actorDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(actorDisclosure).toHaveAccessibleName("Collapse full person or system");
  await actorDisclosure.press("Space");
  await expect(actorDisclosure).toHaveAttribute("aria-expanded", "false");
  await expect(logDialog.getByRole("button", { name: "Show more activity" })).toHaveCount(0);
  await logDialog.getByRole("button", { name: "Close modal" }).click();

  await page.goto("/admin/operations?view=situations");
  await page.getByRole("button", { name: "Select Maintenance Request", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "View situation details" }).click();
  const alertDialog = page.getByRole("dialog", { name: "Maintenance Request" });
  await expect(alertDialog).toBeVisible();
  const alertAccentWidth = await expectTitleSizedAccent(alertDialog, "Maintenance Request");
  expect(alertAccentWidth).toBeGreaterThan(activityAccentWidth);
  await expectSameRow(alertDialog.getByText("What Happened", { exact: true }).locator(".."), alertDialog.getByText("Suggested Response", { exact: true }).locator(".."));
  await expect(alertDialog.getByText(longSummary, { exact: true })).toBeVisible();

  await alertDialog.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "View situation details" }).click();
  await expect(alertDialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Maintenance Request" })).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("themes the shared Admin response panel without a bright dark-mode surface", async ({ page }) => {
  await restoreAdminSession(page);
  await page.goto("/admin/operations?view=situations");
  await page.getByRole("button", { name: "Select Maintenance Request", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "View situation details" }).click();

  const dialog = page.getByRole("dialog", { name: "Maintenance Request" });
  await expect(dialog).toBeVisible();
  const responsePanel = dialog.locator(".tanaw-modal-action-panel");
  await expect(responsePanel).toBeVisible();
  await expect(responsePanel).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(responsePanel.getByText("Record the Admin response")).toBeVisible();
  await expect(responsePanel.getByRole("button", { name: "Start Review" })).toBeVisible();
  await expect(responsePanel.getByRole("button", { name: "Mark Resolved" })).toBeVisible();

  const darkBackground = await responsePanel.evaluate((element) => getComputedStyle(element).backgroundColor);
  await dialog.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "View situation details" }).click();
  await expect(dialog).toBeVisible();
  const lightResponsePanel = page.getByRole("dialog", { name: "Maintenance Request" }).locator(".tanaw-modal-action-panel");
  await expect.poll(() => lightResponsePanel.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(darkBackground);
});
