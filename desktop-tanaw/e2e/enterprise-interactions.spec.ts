import { expect, test, type Page } from "@playwright/test";

const enterpriseUser = {
  id: "enterprise-interactions-test",
  name: "Interaction Test Enterprise",
  displayName: "Interaction Test Enterprise",
  email: "enterprise-interactions@example.test",
  role: "enterprise",
  title: "Enterprise Account",
  enterpriseId: "interaction_test@tanaw.sanpedro",
  enterpriseName: "Interaction Test Enterprise",
  buildingCapacity: 100,
};

async function signIn(page: Page) {
  let signedIn = false;
  await page.addInitScript(() => window.localStorage.setItem("tanaw-enterprise-theme", "dark"));
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "enterprise-interactions-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/session", (route) => {
    if (!signedIn) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Not authenticated" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "enterprise-interactions-token", user: enterpriseUser }) });
  });
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(enterpriseUser) }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/operational/tickets", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("http://127.0.0.1:8765/**", (route) => {
    if (new URL(route.request().url()).pathname === "/context/enterprise") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enterprise_id: enterpriseUser.enterpriseId, enterprise_name: enterpriseUser.enterpriseName }) });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "ML service unavailable in renderer acceptance test" }) });
  });

  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(enterpriseUser.email);
  await page.getByPlaceholder("Enter your password").fill("Enterprise interaction password 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
}

test("updates Support Ticket selects in the same theme transaction", async ({ page }) => {
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

  const lightState = await page.evaluate(() => {
    (document.querySelector('[aria-label="Switch to light mode"]') as HTMLButtonElement).click();
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
  expect(lightState.transitionDelay).toBe("0s");
  await expect(category).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(priority).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await category.click();
  await expect(page.getByRole("listbox", { name: "Category" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Category" }).locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");

  const darkState = await page.evaluate(() => {
    (document.querySelector('[aria-label="Switch to dark mode"]') as HTMLButtonElement).click();
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
  const affectedArea = page.getByPlaceholder("Lobby, reports, account");
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
      body: JSON.stringify({ token: "enterprise-updated-token", user: enterpriseUser }),
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

test("keeps resolved Support Ticket history visible and closes the composer", async ({ page }) => {
  const resolvedTicket = {
    id: "ticket-resolved",
    code: "TCK-000099",
    enterpriseId: enterpriseUser.enterpriseId,
    enterpriseName: enterpriseUser.enterpriseName,
    submittedBy: enterpriseUser.displayName,
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
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith("/ticket-resolved") ? resolvedTicket : [resolvedTicket];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/#/enterprise/tickets");

  await page.getByText("Resolved camera concern", { exact: true }).click();
  await expect(page.getByText("The connection has been restored.", { exact: true })).toBeVisible();
  await expect(page.getByText("This ticket is resolved. The conversation is now closed.", { exact: false })).toBeVisible();
  await expect(page.getByText("Reply in TANAW", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send Reply" })).toHaveCount(0);
});

test("themes the camera modal and keeps the minimized Tripwire toolbar draggable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/#/enterprise/cameras");
  const cameraNavigation = page.getByRole("button", { name: "Camera Setup", exact: true });
  const dashboardNavigation = page.getByRole("button", { name: "Dashboard", exact: true });
  const reportsNavigation = page.getByRole("button", { name: "Reports", exact: true });
  const glassIndicator = page.locator("[data-topbar-glass-indicator='true']");
  const activeUnderline = cameraNavigation.locator("[data-topbar-active-underline='true']");
  await expect(cameraNavigation).toHaveAttribute("aria-current", "page");
  await expect(activeUnderline).toHaveCount(1);
  await expect(glassIndicator).toHaveCount(0);
  await expect(page.locator("[data-topbar-active-surface], [data-topbar-liquid-layer], [data-topbar-liquid-bridge]")).toHaveCount(0);
  await dashboardNavigation.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "dashboard");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-origin", "droplet-center");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-motion", "edge-glide");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-geometry", "independent-endcaps");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-shape", "capsule-droplet");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge", "adaptive-neutral-refraction");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-thickness", "hairline");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-edge-distortion", "subtle");
  const refractiveEdge = glassIndicator.locator("[data-topbar-glass-refraction='background-adaptive']");
  await expect(refractiveEdge).toHaveCount(1);
  await expect(refractiveEdge).toHaveCSS("filter", /tanaw-topbar-edge-distortion/);
  await expect(glassIndicator).toHaveCSS("border-top-width", "0px");
  await expect(refractiveEdge).toHaveCSS("padding-top", "0.75px");
  await expect(glassIndicator).toHaveCSS("clip-path", "none");
  await page.waitForTimeout(480);
  const dashboardBox = await dashboardNavigation.boundingBox();
  const cameraBox = await cameraNavigation.boundingBox();
  expect(dashboardBox).not.toBeNull();
  expect(cameraBox).not.toBeNull();
  await cameraNavigation.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "cameras");
  await page.waitForTimeout(260);
  const stretchedGlassBox = await glassIndicator.boundingBox();
  expect(stretchedGlassBox).not.toBeNull();
  const dashboardCenter = dashboardBox!.x + dashboardBox!.width / 2;
  const cameraCenter = cameraBox!.x + cameraBox!.width / 2;
  const glidingCenter = stretchedGlassBox!.x + stretchedGlassBox!.width / 2;
  const fullUnionWidth = cameraBox!.x + cameraBox!.width - dashboardBox!.x;
  expect(glidingCenter).toBeGreaterThan(dashboardCenter);
  expect(glidingCenter).toBeLessThan(cameraCenter);
  expect(stretchedGlassBox!.width).toBeLessThan(fullUnionWidth * 0.85);
  await expect(glassIndicator).toHaveCSS("border-radius", "999px");
  await page.mouse.move((dashboardBox!.x + dashboardBox!.width + cameraBox!.x) / 2, cameraBox!.y + cameraBox!.height / 2);
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-state", "gap");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "gap:dashboard:cameras");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-deformation", "1.000");
  await expect(glassIndicator).toHaveCSS("border-radius", "999px");
  await reportsNavigation.hover();
  const reportsGlass = glassIndicator;
  await expect(reportsGlass).toHaveAttribute("data-topbar-glass-target", "reports");
  await page.waitForTimeout(720);
  const reportsBox = await reportsNavigation.boundingBox();
  const reportsGlassBox = await reportsGlass.boundingBox();
  expect(reportsGlassBox!.x + reportsGlassBox!.width / 2).toBeCloseTo(reportsBox!.x + reportsBox!.width / 2, 0);
  await expect(reportsNavigation).not.toHaveCSS("transform", /matrix/);
  await cameraNavigation.hover();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "cameras");
  await expect(activeUnderline).toHaveCount(1);
  await page.mouse.move(900, 150);
  await expect(glassIndicator).toHaveCount(0);
  await expect(activeUnderline).toHaveCount(1);
  await dashboardNavigation.focus();
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "dashboard");
  await page.keyboard.press("Tab");
  await expect(glassIndicator).toHaveAttribute("data-topbar-glass-target", "cameras");

  const addCamera = page.getByRole("button", { name: "Add Camera", exact: true });
  await expect(addCamera).toHaveCount(1);
  await expect(addCamera).toBeVisible();
  await addCamera.click();

  let dialog = page.getByRole("dialog", { name: "Add Camera" });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dialog.getByText("RTSP Camera Configuration", { exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Password", exact: true }).fill("secret-camera-password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(dialog.getByRole("textbox", { name: "Password", exact: true })).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await addCamera.click();
  dialog = page.getByRole("dialog", { name: "Add Camera" });
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await dialog.getByRole("textbox", { name: "Camera Name", exact: true }).fill("Entrance");
  await dialog.getByRole("textbox", { name: "Assigned Zone", exact: true }).fill("Lobby");
  await dialog.getByPlaceholder("192.168.1.9").fill("127.0.0.1");
  await dialog.getByRole("textbox", { name: "Username", exact: true }).fill("admin");
  await dialog.getByRole("textbox", { name: "Password", exact: true }).fill("camera-password");
  await dialog.getByRole("button", { name: "Save Configuration" }).click();

  const controlsHeading = page.getByText("SYSTEM STATUS & CONTROLS", { exact: true });
  await expect(controlsHeading).toBeVisible();
  await expect(page.getByText("Camera Connection", { exact: true })).toBeVisible();
  await expect(page.getByText("Stream Protocol", { exact: true })).toBeVisible();
  await expect(page.getByText("Profile pending", { exact: false })).toHaveCount(0);
  await expect(page.getByText("FPS adaptive", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Frame Telemetry Idle", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Service", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  const cameraWorkspace = page.locator("[data-camera-sidebar]");
  const cameraPanel = page.locator("#configured-cameras-panel");
  const selectedCamera = cameraPanel.locator("button[aria-pressed='true']");
  const selectedCameraTop = (await selectedCamera.boundingBox())?.y ?? 0;
  await selectedCamera.hover();
  await expect(selectedCamera).toHaveCSS("transform", "none");
  expect((await selectedCamera.boundingBox())?.y ?? 0).toBeCloseTo(selectedCameraTop, 0);
  const collapseControl = page.getByRole("button", { name: "Collapse configured cameras" });
  const expandedPanelBox = await cameraPanel.boundingBox();
  const expandedControlBox = await collapseControl.boundingBox();
  expect(expandedControlBox && expandedPanelBox).toBeTruthy();
  expect((expandedControlBox?.x ?? 0) + (expandedControlBox?.width ?? 0) / 2).toBeCloseTo((expandedPanelBox?.x ?? 0) + (expandedPanelBox?.width ?? 0), 0);
  expect((expandedControlBox?.y ?? 0) + (expandedControlBox?.height ?? 0) / 2).toBeCloseTo((expandedPanelBox?.y ?? 0) + (expandedPanelBox?.height ?? 0) / 2, 0);
  const previewWorkspace = cameraWorkspace.locator(":scope > div").nth(1);
  const expandedPreviewWidth = (await previewWorkspace.boundingBox())?.width ?? 0;
  await collapseControl.click();
  await expect(cameraWorkspace).toHaveAttribute("data-camera-sidebar", "collapsed");
  await expect(page.getByRole("button", { name: "Expand configured cameras" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await previewWorkspace.boundingBox())?.width ?? 0).toBeGreaterThan(expandedPreviewWidth + 100);
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeVisible();
  const expandControl = page.getByRole("button", { name: "Expand configured cameras" });
  const collapsedPanelBox = await cameraPanel.boundingBox();
  const collapsedControlBox = await expandControl.boundingBox();
  expect((collapsedControlBox?.y ?? 0) + (collapsedControlBox?.height ?? 0) / 2).toBeCloseTo((collapsedPanelBox?.y ?? 0) + (collapsedPanelBox?.height ?? 0) / 2, 0);
  await expandControl.click();
  await expect(cameraWorkspace).toHaveAttribute("data-camera-sidebar", "expanded");
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
  expect(Number.parseFloat(await addCamera.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThan(12);

  await page.getByRole("button", { name: "Edit configuration" }).click();
  await page.getByRole("button", { name: "Hide tripwire toolbar" }).click();
  const minimized = page.getByRole("button", { name: "Show tripwire toolbar" });
  const toolbar = minimized.locator("..");
  const overlay = toolbar.locator("..");
  const before = await toolbar.boundingBox();
  expect(before).not.toBeNull();

  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 120, before!.y + before!.height / 2 + 70, { steps: 5 });
  await page.mouse.up();
  const after = await toolbar.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).toBeGreaterThan(before!.x + 80);
  expect(after!.y).toBeGreaterThan(before!.y + 40);
  await expect(minimized).toBeVisible();
  await expect(page.getByRole("button", { name: "Move tripwire toolbar" })).toHaveCount(0);

  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  await page.mouse.move(after!.x + after!.width / 2, after!.y + after!.height / 2);
  await page.mouse.down();
  await page.mouse.move(overlayBox!.x - 100, overlayBox!.y - 100, { steps: 5 });
  await page.mouse.up();
  const clamped = await toolbar.boundingBox();
  expect(clamped).not.toBeNull();
  expect(clamped!.x).toBeGreaterThanOrEqual(overlayBox!.x);
  expect(clamped!.y).toBeGreaterThanOrEqual(overlayBox!.y);

  await minimized.click();
  await expect(page.getByRole("button", { name: "Move tripwire toolbar" })).toBeVisible();

  await page.setViewportSize({ width: 800, height: 500 });
  await expect(page.getByRole("heading", { name: "Camera Setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
  await page.getByText("SYSTEM STATUS & CONTROLS", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Test", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).toHaveCSS("color", "rgb(255, 248, 232)");
  await expect(pendingCard.locator(".enterprise-profile-pending-email__copy")).toHaveCSS("color", "rgb(216, 222, 232)");
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(pendingCard.locator(".enterprise-profile-pending-email__title")).not.toHaveCSS("color", "rgb(255, 248, 232)");
  await expect(page.getByText("proposed-enterprise@example.test", { exact: false })).toBeVisible();
});
