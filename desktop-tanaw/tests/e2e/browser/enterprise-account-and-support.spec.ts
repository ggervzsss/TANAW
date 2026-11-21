// Enterprise Support Tickets, account settings, and desktop navigation.
import { expect, test, type Locator } from "@playwright/test";
import { mockCameraSetup, mockRememberedSession, switchTheme } from "./support/preload";
import { signIn, defaultEnterpriseUser } from "./support/session";
import { token } from "../support/theme-and-filters";

async function expectSettledTopbarUnderline(underline: Locator, tab: Locator) {
  await expect(underline).toBeVisible();
  const bounds = (await tab.locator("[data-topbar-label]").boundingBox())!;
  await expect
    .poll(async () => {
      const line = (await underline.boundingBox())!;
      return Math.abs(line.x + line.width / 2 - bounds.x - bounds.width / 2) + Math.abs(line.y - bounds.y - bounds.height - 4) + Math.abs(line.width - bounds.width * 0.8);
    })
    .toBeLessThan(2);
}

test("updates Support Ticket selects together after a theme change", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/#/enterprise/tickets");

  const category = page.getByRole("combobox", { name: "Category" });
  const priority = page.getByRole("combobox", { name: "Priority" });
  await expect(category).toBeVisible();
  await expect(priority).toBeVisible();
  const initialDarkState = await page.evaluate(() => ({
    categoryBackground: getComputedStyle(document.querySelector('[aria-label="Category"]') as HTMLElement).backgroundColor,
    priorityBackground: getComputedStyle(document.querySelector('[aria-label="Priority"]') as HTMLElement).backgroundColor,
  }));
  expect(initialDarkState.categoryBackground).not.toBe("rgb(255, 255, 255)");
  expect(initialDarkState.priorityBackground).toBe(initialDarkState.categoryBackground);

  await switchTheme(page, "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const lightState = await page.evaluate(() => {
    const categorySelect = document.querySelector('[aria-label="Category"]') as HTMLElement;
    const prioritySelect = document.querySelector('[aria-label="Priority"]') as HTMLElement;
    return {
      categoryBackground: getComputedStyle(categorySelect).backgroundColor,
      isDark: document.documentElement.classList.contains("dark"),
      priorityBackground: getComputedStyle(prioritySelect).backgroundColor,
      transitionDelay: getComputedStyle(categorySelect).transitionDelay,
    };
  });
  expect(lightState.isDark).toBe(false);
  expect(lightState.priorityBackground).toBe(lightState.categoryBackground);
  expect(lightState.transitionDelay.split(",").every((delay) => delay.trim() === "0s")).toBe(true);
  await expect(category).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(priority).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await category.click();
  await expect(page.getByRole("listbox", { name: "Category" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Category" }).locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");

  await switchTheme(page, "dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkState = await page.evaluate(() => {
    const categorySelect = document.querySelector('[aria-label="Category"]') as HTMLElement;
    const prioritySelect = document.querySelector('[aria-label="Priority"]') as HTMLElement;
    return {
      categoryBackground: getComputedStyle(categorySelect).backgroundColor,
      isDark: document.documentElement.classList.contains("dark"),
      priorityBackground: getComputedStyle(prioritySelect).backgroundColor,
    };
  });
  expect(darkState.isDark).toBe(true);
  expect(darkState.priorityBackground).toBe(darkState.categoryBackground);
  await expect(category).toHaveCSS("background-color", initialDarkState.categoryBackground);
  await expect(priority).toHaveCSS("background-color", initialDarkState.priorityBackground);
});

test("reveals and focuses the first invalid Support Ticket field", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await signIn(page);
  await page.goto("/#/enterprise/tickets");

  await page.getByRole("button", { name: "Submit Ticket" }).click();
  const subject = page.getByPlaceholder("Brief summary of the issue");
  await expect(subject).toBeFocused();
  await expect(subject).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a ticket subject.", { exact: true })).toBeVisible();

  await subject.fill("Camera unavailable");
  await page.getByPlaceholder("Describe what happened, when it started, and any affected workflows.").fill("The camera feed stopped updating this morning.");
  await page.getByRole("button", { name: "Submit Ticket" }).click();
  const affectedArea = page.getByRole("textbox", { name: /^Affected Area/ });
  await expect(affectedArea).toBeFocused();
  await expect(affectedArea).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter the affected area.", { exact: true })).toBeVisible();
});

test("keeps Enterprise password inputs empty and reveals only manually entered text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/auth/change-password", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      currentPassword: "Current enterprise passphrase 2026",
      newPassword: "Replacement enterprise passphrase 2026",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "enterprise-updated-token", user: defaultEnterpriseUser }),
    });
  });
  await signIn(page);
  await page.goto("/#/enterprise/security");

  const currentPassword = page.getByPlaceholder("Enter your current password");
  const newPassword = page.getByPlaceholder("Use a long password");
  const confirmation = page.getByPlaceholder("Repeat the password");
  const currentToggle = page.getByRole("button", { name: "Show current password" });
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  await expect(currentPassword).toHaveAttribute("autocomplete", "new-password");
  await expect(currentPassword).toHaveAttribute("readonly", "");
  await expect(currentPassword).toHaveAttribute("data-1p-ignore", "true");
  await expect(currentToggle).toBeDisabled();

  await currentPassword.focus();
  await expect(currentPassword).not.toHaveAttribute("readonly", "");
  await currentPassword.fill("Current enterprise passphrase 2026");
  await expect(currentToggle).toBeEnabled();
  await currentToggle.click();
  await expect(currentPassword).toHaveAttribute("type", "text");
  await expect(currentPassword).toHaveValue("Current enterprise passphrase 2026");
  await page.getByRole("button", { name: "Hide current password" }).click();
  await newPassword.fill("Replacement enterprise passphrase 2026");
  await confirmation.fill("Replacement enterprise passphrase 2026");
  await page.getByRole("button", { name: "Update Password" }).click();
  await expect(page.getByText("Password updated.")).toBeVisible();
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");

  await page.goto("/#/enterprise/dashboard");
  await page.goto("/#/enterprise/security");
  await expect(page.getByPlaceholder("Enter your current password")).toHaveValue("");
  await expect(page.getByPlaceholder("Use a long password")).toHaveValue("");
  await expect(page.getByPlaceholder("Repeat the password")).toHaveValue("");
});

test("submits a Support Ticket and keeps resolved history visible", async ({ page }) => {
  const resolvedTicket = {
    id: "ticket-resolved",
    code: "TCK-000099",
    enterpriseId: defaultEnterpriseUser.enterpriseId,
    enterpriseName: defaultEnterpriseUser.enterpriseName,
    submittedBy: defaultEnterpriseUser.displayName,
    category: "Camera Issue",
    priority: "High",
    subject: "Resolved camera concern",
    description: "The camera concern has already been resolved.",
    affectedArea: "Lobby",
    cameraNode: null,
    attachments: [],
    status: "Resolved",
    createdAt: "2026-07-23T12:11:04.071391+00:00",
    updatedAt: "2026-07-23T12:15:04.071391+00:00",
    messages: [
      {
        id: "message-1",
        authorName: "Default IT Personnel",
        authorRole: "it",
        message: "The connection has been restored.",
        createdAt: "2026-07-23T12:14:04.071391+00:00",
      },
    ],
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.route("**/operational/tickets**", (route) => {
    if (route.request().method() === "POST") {
      const request = route.request().postDataJSON();
      expect(request).toMatchObject({ category: "Report Concern", priority: "Normal", subject: "Report summary question" });
      return route.fulfill({ json: { ...resolvedTicket, ...request, id: "ticket-new", code: "TCK-000100", status: "Open", messages: [] } });
    }
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith("/ticket-resolved") ? resolvedTicket : [resolvedTicket];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "General Settings" }).click();
  await page.getByRole("button", { name: "Support Tickets" }).click();
  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Report Concern" }).click();
  await page.getByRole("combobox", { name: "Priority" }).click();
  await page.getByRole("option", { name: "Normal" }).click();
  await page.getByLabel("Subject", { exact: true }).fill("Report summary question");
  await page.getByLabel("Description", { exact: true }).fill("Please help confirm the correct date range for the visitor report.");
  await page.getByRole("button", { name: "Submit Ticket" }).click();
  await expect(page.getByText("Ticket TCK-000100 submitted.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Report summary question/ })).toBeVisible();

  await page.getByRole("button", { name: /Resolved camera concern/ }).click();
  await expect(page.getByText("The connection has been restored.", { exact: true })).toBeVisible();
  await expect(page.getByText("This ticket is resolved. The conversation is now closed.", { exact: false })).toBeVisible();
  await expect(page.getByText("Reply in TANAW", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send Reply" })).toHaveCount(0);
});

test("keeps the active underline visible and retargets it through desktop navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockRememberedSession(page);
  await signIn(page, () => mockCameraSetup(page, defaultEnterpriseUser.enterpriseId), true);
  await page.goto("/#/enterprise/cameras");
  const navigation = page.getByRole("navigation", { name: "Enterprise navigation", exact: true });
  const cameras = navigation.getByRole("button", { name: "Camera Setup" });
  const dashboard = navigation.getByRole("button", { name: "Dashboard" });
  const reports = navigation.getByRole("button", { name: "Reports" });
  const underline = navigation.locator("[data-topbar-underline]");

  await expect(cameras).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarUnderline(underline, cameras);
  await expect(underline).toHaveCSS("height", "2px");
  await dashboard.hover();
  await expect(dashboard).toHaveCSS("color", "rgb(158, 241, 200)");
  await expectSettledTopbarUnderline(underline, cameras);
  await dashboard.click();
  await expect(dashboard).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarUnderline(underline, dashboard);

  const from = (await dashboard.locator("[data-topbar-label]").boundingBox())!;
  const to = (await reports.locator("[data-topbar-label]").boundingBox())!;
  await Promise.all([
    page.waitForFunction(
      ({ min, max }) => {
        const line = document.querySelector("[data-topbar-underline]");
        if (!line) return false;
        const rect = line.getBoundingClientRect();
        const center = rect.x + rect.width / 2;
        return center > min + 8 && center < max - 8 && getComputedStyle(line).visibility === "visible";
      },
      { min: from.x + from.width / 2, max: to.x + to.width / 2 },
    ),
    reports.press("Enter"),
  ]);
  await cameras.press("Enter");
  await reports.press("Enter");
  await expect(reports).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarUnderline(underline, reports);
  await expect(reports).toHaveCSS("transform", "none");

  await page.goBack();
  await expect(cameras).toHaveAttribute("aria-current", "page");
  await expectSettledTopbarUnderline(underline, cameras);
  await page.reload();
  await expectSettledTopbarUnderline(underline, cameras);
  await dashboard.focus();
  await expect(dashboard).toHaveCSS("outline-style", "solid");
  await expect(cameras).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 800, height: 700 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobile = page.getByRole("navigation", { name: "Enterprise mobile navigation" });
  await expect(mobile.getByRole("button", { name: "Camera Setup" })).toHaveAttribute("aria-current", "page");
  await expect(mobile.locator("[data-topbar-underline]")).toBeVisible();
});

test("keeps pending business-email information readable in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await page.route("**/auth/profile/business-email-change", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ requestedEmail: "proposed-enterprise@example.test", status: "pending" }),
    }),
  );
  await page.goto("/#/enterprise/profile");

  const pendingCard = page.locator(".enterprise-profile-pending-email");
  await expect(pendingCard).toBeVisible();
  await expect(page.getByText("proposed-enterprise@example.test", { exact: false })).toBeVisible();
  const darkTitle = await token(page, "--theme-text");
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).toHaveCSS("color", darkTitle);
  await expect(pendingCard.locator(".enterprise-profile-pending-email__copy")).toHaveCSS("color", await token(page, "--theme-secondary"));
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();

  await switchTheme(page, "light");
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).not.toHaveCSS("color", darkTitle);
  await expect(page.getByText("proposed-enterprise@example.test", { exact: false })).toBeVisible();
});
