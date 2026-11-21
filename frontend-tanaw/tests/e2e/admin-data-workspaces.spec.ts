// Admin Visitor Insights and data workspaces (Alerts & Requests, Activity History).
import { expect, test } from "@playwright/test";
import { mapEnterprise, configureAdminMapSession, waitForMapReady, readSettledMapGeometry, readMapGeometry, expectSameCamera } from "./support/adminMap";
import { waitForStillPage } from "./support/session";

test("presents Visitor Insights as an accessible analytical workspace and highlights directory markers without changing map selection", async ({ page }, testInfo) => {
  await configureAdminMapSession(page);

  const marker = page.locator('#admin-enterprise-map .tanaw-map-pin[aria-label^="Map Camera Test Enterprise"]');
  const markerBody = marker.locator(".tanaw-enterprise-marker__body");
  const card = page.locator(".tanaw-map-enterprise-card").filter({ hasText: "Map Camera Test Enterprise" });
  await expect(marker.locator('.tanaw-enterprise-marker[data-tone="running"]')).toBeVisible();
  await expect(marker.locator(".tanaw-enterprise-marker__body svg")).toBeVisible();
  await expect(markerBody).toHaveCSS("width", "44px");
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "false");

  await card.hover();
  await expect(marker).toHaveClass(/is-directory-hovered/);
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("heading", { name: "Spatial Directory" }).hover();
  await expect(marker).not.toHaveClass(/is-directory-hovered/);
  await marker.hover();
  await expect(markerBody).toHaveCSS("transform", /^matrix\(1\.08,/);
  const tooltip = page.locator(".tanaw-enterprise-tooltip");
  await expect(tooltip).toContainText(mapEnterprise.fullAddress);
  await expect(tooltip).toContainText("Attraction · San Antonio");
  await expect(tooltip).toContainText("1/1 reporting");
  await expect(tooltip).toContainText("Live occupancy");
  await expect(tooltip).toContainText("12");
  const beforeMarkerClick = await readMapGeometry(page);
  await marker.click();
  const preview = page.getByRole("region", { name: "Enterprise preview" });
  await expect(preview).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(marker).toHaveClass(/is-selected/);
  await expect(card.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readMapGeometry(page)).boundary.width).toBeGreaterThan(beforeMarkerClick.boundary.width);
  await expect(page.locator("#admin-enterprise-map .leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const focusedCamera = await readSettledMapGeometry(page);
  expect(Math.abs(focusedCamera.marker.centerX - (focusedCamera.map.left + focusedCamera.map.right) / 2)).toBeLessThan(40);
  await page.getByRole("button", { name: "Close enterprise preview" }).click();
  await expect(preview).toHaveCount(0);
  expectSameCamera(await readSettledMapGeometry(page), focusedCamera);

  const insightsLink = page.getByRole("link", { name: "Visitor Insights" });
  await insightsLink.click();
  await expect(page).toHaveURL(/\/admin\/visitor-insights$/);
  await expect(insightsLink).toHaveAttribute("aria-current", "page");
  const insights = page.locator(".tanaw-visitor-insights");
  await expect(insights.getByRole("heading", { name: "San Pedro" })).toBeVisible();
  await expect(insights.getByText("Visitors Right Now", { exact: true })).toBeVisible();
  await expect(insights.getByText("Learning", { exact: true })).toBeVisible();
  await expect(insights.getByText("Building a reliable comparison", { exact: true })).toBeVisible();
  await expect(insights.getByText("Activity Pattern", { exact: true })).toBeVisible();
  const chartBar = insights.locator(".recharts-bar-rectangle path").first();
  await expect(chartBar).toBeVisible();
  await expect(chartBar).toHaveCSS("fill", "rgb(13, 151, 106)");
  await expect(insights.getByText("Busiest Right Now", { exact: true })).toBeVisible();
  await expect(insights.getByText("Busiest Period", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("visitor-insights-light.png"), fullPage: true });
  const historyMetric = insights.getByRole("radiogroup", { name: "History metric" });
  const occupancy = historyMetric.getByRole("radio", { name: "Occupancy", exact: true });
  const unique = historyMetric.getByRole("radio", { name: "Estimated Unique" });
  await expect(occupancy).toBeChecked();
  await occupancy.press("ArrowRight");
  await expect(unique).toBeChecked();
  await expect(unique).toBeFocused();
  await expect(insights.getByText("Last daily estimate for each establishment")).toBeVisible();
  await expect(insights.locator(".recharts-bar-rectangle")).toHaveCount(2);

  const selectedRange = insights.getByRole("tab", { name: "7 Days" });
  await expect(selectedRange).toHaveAttribute("aria-selected", "true");
  await selectedRange.focus();
  await page.keyboard.press("ArrowRight");
  await expect(insights.getByRole("tab", { name: "30 Days" })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page.getByRole("link", { name: "Map View" })).toHaveAttribute("aria-current", "page");
  await waitForMapReady(page);
  await page.goForward();
  await expect(insightsLink).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(insightsLink).toHaveAttribute("aria-current", "page");
  await expect(insights.getByRole("heading", { name: "San Pedro" })).toBeVisible();
});

test("keeps the modernized Admin data workspaces semantic and keyboard operable", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await configureAdminMapSession(page);

  let resolutionStatus = "Unresolved";
  await page.route("**/activity-logs**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "activity-modernization-1",
          timestamp: new Date().toISOString(),
          category: "Admin Operation",
          severity: "Success",
          actor: "LGU Admin",
          actorRole: "Admin",
          action: "Login",
          target: "admin@email.com",
          summary: "LGU Admin signed in to TANAW.",
          sourceId: null,
          metadata: {},
        },
        {
          id: "activity-modernization-2",
          timestamp: "2026-08-11T11:59:00+08:00",
          category: "Staff Submission",
          severity: "Info",
          actor: "LGU Staff",
          actorRole: "LGU Staff",
          action: "Submit Enterprise Report",
          target: "Archie's Event Place",
          summary: "LGU Staff submitted the latest establishment activity report for Admin review.",
          sourceId: null,
          metadata: {},
        },
        {
          id: "activity-modernization-3",
          timestamp: "2026-08-08T11:20:00+08:00",
          category: "Enterprise Activity",
          severity: "Warning",
          actor: "San Pedro Convention Hall",
          actorRole: "Enterprise Account",
          action: "Desktop Application Problem",
          target: "San Pedro Convention Hall",
          summary: "Camera stopped reporting.",
          resolutionStatus,
        },
      ]),
    }),
  );
  await page.route("**/operational/alerts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "alert-modernization-1",
          type: "Foot Traffic Alert",
          severity: "Critical",
          urgency: "Urgent",
          enterprise: "Archie's Event Place",
          requester: "System",
          summary: "Archie's Event Place currently has 68 visitors, compared with its usual 17 around this day and time.",
          requiredAction: "Review the live map and coordinate with the establishment, traffic team, or public-safety partners.",
          resolutionMode: "Admin Monitoring",
          status: "New",
          owner: "Admin",
          time: "2026-08-13T11:40:00+08:00",
        },
        {
          id: "alert-modernization-2",
          type: "Occupancy Spike",
          severity: "Warning",
          urgency: "Important",
          enterprise: "San Pedro Convention Hall",
          requester: "System",
          summary: "San Pedro Convention Hall is approaching its expected busy-period occupancy.",
          requiredAction: "Continue monitoring the establishment and confirm that entry controls are ready.",
          resolutionMode: "Admin Monitoring",
          status: "In Review",
          owner: "Admin",
          time: "2026-08-13T11:35:00+08:00",
        },
      ]),
    }),
  );

  await page.getByRole("link", { name: "Activity History" }).click();
  const auditWorkspace = page.locator(".tanaw-audit-workspace");
  await expect(auditWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Activity history summary" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search activity history" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter activity category" })).toContainText("All Activity");
  for (const heading of ["Date and Time", "Activity", "Performed By", "Affected Item", "Details"]) {
    await expect(auditWorkspace.getByRole("columnheader", { name: heading })).toBeVisible();
  }
  await expect(auditWorkspace.getByText("LGU Admin signed in to TANAW.").first()).toBeVisible();
  const activityRows = auditWorkspace.locator("tbody tr");
  await expect(activityRows.first()).toContainText("Unresolved");
  await expect(activityRows.first()).toContainText("Desktop Application Problem");
  const summary = page.getByRole("region", { name: "Activity history summary" });
  const category = page.getByRole("combobox", { name: "Filter activity category" });
  const today = summary.getByRole("button", { name: /^Today/ });
  await today.click();
  await expect(today).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Filter activity time range" })).toContainText("Today");
  await expect(activityRows).toHaveCount(1);
  await expect(activityRows.first()).toContainText("Login");
  await today.click();

  for (const [label, option, action] of [
    ["Report Updates", "Reports", "Submit Enterprise Report"],
    ["Admin Activity", "Admin Activity", "Login"],
    ["Important Updates", "Important Updates", "Desktop Application Problem"],
  ]) {
    const shortcut = summary.getByRole("button", { name: new RegExp(`^${label}`) });
    await shortcut.press("Enter");
    await expect(shortcut).toHaveAttribute("aria-pressed", "true");
    await expect(category).toContainText(option);
    await expect(activityRows).toHaveCount(1);
    await expect(activityRows.first()).toContainText(action);
  }
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(category).toContainText("All Activity");
  await expect(activityRows).toHaveCount(3);

  const activitySearch = page.getByRole("textbox", { name: "Search activity history" });
  await activitySearch.fill("Submit Enterprise Report");
  await expect(auditWorkspace.getByText("Submit Enterprise Report", { exact: true }).first()).toBeVisible();
  await expect(auditWorkspace.getByText("Login", { exact: true })).toHaveCount(0);
  await activitySearch.clear();
  await auditWorkspace.getByRole("row", { name: /View details for Login/ }).press("Enter");
  await expect(page.getByRole("dialog")).toContainText("LGU Admin signed in to TANAW.");
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("activity-history-light.png"), fullPage: true });

  resolutionStatus = "Resolved";
  await page.reload();
  await expect(activityRows.first()).toContainText("Login");
  await expect(activityRows.last()).toContainText("Desktop Application Problem");
  await expect(activityRows.last().getByText("Resolved", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Alerts & Requests" }).click();
  const operationsWorkspace = page.locator(".tanaw-operations-workspace");
  await expect(operationsWorkspace).toBeVisible();
  await expect(page.getByRole("region", { name: "Alerts & Requests summary" })).toBeVisible();
  await expect(operationsWorkspace.getByRole("region", { name: "Situation queue" })).toBeVisible();
  const situationDetails = operationsWorkspace.getByRole("region", { name: "Selected situation details" });
  for (const label of ["Establishment", "What Happened", "Urgency", "Status"]) await expect(situationDetails.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(operationsWorkspace.getByText("Archie's Event Place", { exact: true }).first()).toBeVisible();
  const secondSituation = operationsWorkspace.getByRole("button", { name: "Select Sudden Crowd Increase" });
  await secondSituation.focus();
  await page.keyboard.press("Enter");
  await expect(secondSituation).toHaveAttribute("aria-pressed", "true");
  await expect(situationDetails.getByText("San Pedro Convention Hall", { exact: true }).first()).toBeVisible();
  await situationDetails.getByRole("button", { name: "View situation details" }).click();
  await expect(page.getByRole("dialog")).toContainText("San Pedro Convention Hall");
  await page.getByRole("button", { name: "Close modal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("operations-center-light.png"), fullPage: true });

  await page.setViewportSize({ width: 900, height: 900 });
  const [stackedQueueBox, stackedDetailsBox] = await Promise.all([
    operationsWorkspace.getByRole("region", { name: "Situation queue" }).boundingBox(),
    operationsWorkspace.getByRole("region", { name: "Selected situation details" }).boundingBox(),
  ]);
  expect(stackedQueueBox).not.toBeNull();
  expect(stackedDetailsBox).not.toBeNull();
  expect(stackedDetailsBox!.y).toBeGreaterThan(stackedQueueBox!.y + stackedQueueBox!.height);

  const situationsTab = operationsWorkspace.getByRole("tab", { name: "Needs Attention" });
  await situationsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(operationsWorkspace.getByRole("tab", { name: "Escalated Support" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(operationsWorkspace.getByRole("tab", { name: "Account Requests" })).toHaveAttribute("aria-selected", "true");
});

test("keeps Visitor Insights and Admin data workspaces intentionally layered in dark mode", async ({ page }, testInfo) => {
  await configureAdminMapSession(page, { followSystem: true, theme: "dark", viewport: { width: 1366, height: 768 } });
  await page.getByRole("link", { name: "Visitor Insights" }).click();
  await expect(page.getByRole("heading", { name: "Visitor Insights" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await waitForStillPage(page);
  await page.screenshot({ path: testInfo.outputPath("visitor-insights-dark.png"), fullPage: true });

  await page.getByRole("link", { name: "Activity History" }).click();
  await expect(page.locator(".tanaw-audit-workspace")).toBeVisible();
  for (const [filterName, initial, next] of [
    ["Filter activity category", "All Activity", "Reports"],
    ["Filter activity time range", "All Time", "Today"],
  ]) {
    const filter = page.getByRole("combobox", { name: filterName });
    await expect(filter).toHaveCSS("background-color", "rgb(25, 38, 51)");
    await filter.hover();
    await expect(filter).toHaveCSS("background-color", "rgb(32, 46, 60)");
    await filter.press("Enter");
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    await expect(filter).toHaveCSS("border-top-color", "rgb(94, 234, 212)");
    const menu = page.getByRole("listbox", { name: filterName });
    await expect(menu.locator("..")).toHaveCSS("background-color", "rgb(25, 37, 49)");
    await expect(menu.getByRole("option", { name: initial, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("option", { name: next, exact: true })).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Enter");
    await expect(filter).toContainText(next);
    await expect(filter).toBeFocused();
    await expect(filter).toHaveCSS("border-top-color", "rgb(94, 234, 212)");
  }
  await page.screenshot({ path: testInfo.outputPath("activity-history-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  for (const [filterName, next] of [
    ["Filter activity category", "Reports"],
    ["Filter activity time range", "Today"],
  ]) {
    const filter = page.getByRole("combobox", { name: filterName });
    await expect(filter).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await filter.click();
    await expect(filter).toHaveCSS("border-top-color", "rgb(15, 118, 110)");
    const menu = page.getByRole("listbox", { name: filterName });
    await expect(menu.locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(menu.getByRole("option", { name: next, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(filter).toHaveAttribute("aria-expanded", "false");
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.getByRole("link", { name: "Alerts & Requests" }).click();
  await expect(page.locator(".tanaw-operations-workspace")).toBeVisible();
  await waitForStillPage(page);
  await page.screenshot({ path: testInfo.outputPath("operations-center-dark.png"), fullPage: true });
});
