import { selectDashboardPeriod } from "./support/dashboard";
import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";
import { verifyReportsPolish } from "../support/reports-polish";
import { verifyFinalReports } from "../support/reports-final";

async function setup(page: Page) {
  const mlRequests: string[] = [];
  const operationalRequests: Array<{ method: string; body: string }> = [];
  const user = { id: "visualization-operator", email: "ui@example.test", role: "enterprise", name: "UI Operator", enterpriseId: "ui-enterprise", enterpriseName: "Tourism UI Preview" };
  let signedIn = false;
  await page.routeWebSocket("**/realtime/ws", (socket) =>
    socket.onMessage((message) => {
      if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("tanaw-enterprise-theme", "light");
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      writes.push(String(value));
      original.call(this, key, value);
    };
    Object.assign(window, { __dashboardStorageWrites: writes });
  });
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ json: { token: "visualization-session", user } });
  });
  await page.route("**/auth/session", (route) => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { token: "visualization-session", user } : { detail: "Sign in" } }));
  await page.route("**/auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/auth/system-settings", (route) => route.fulfill({ json: { values: { "display.timeFormat": "12-hour" } } }));
  await page.route("**/operational/**", (route) => {
    operationalRequests.push({ method: route.request().method(), body: route.request().postData() ?? "" });
    return route.fulfill({ json: [] });
  });
  await mockMlRequest(page, "*", (request) => {
    mlRequests.push(new URL(request.url).pathname);
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Camera service intentionally disconnected in visualization test" }) });
  });
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(user.email);
  await page.getByPlaceholder("Enter your password").fill("UI test session password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-dashboard-source="mock"]')).toBeVisible({ timeout: 20_000 });
  return { mlRequests, operationalRequests };
}

test("renders the complete sample Dashboard offline without persisting or transmitting fixtures", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await setup(page);
  const metrics = page.getByRole("region", { name: "Enterprise analytics summary" });
  for (const [id, value] of [
    ["occupancy", "462"],
    ["entries", "1,248"],
    ["exits", "786"],
    ["visitors", "1,112"],
  ]) {
    await expect(metrics.locator(`[data-metric-segment="${id}"]`).getByText(value, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Tourism Overview · Mock data", { exact: true })).toBeVisible();
  await expect(page.locator(".overview-charts .recharts-bar-rectangle")).toHaveCount(18);
  await expect(page.locator(".overview-charts .recharts-area-curve")).toHaveCount(1);
  await expect(page.locator(".tanaw-demographics-chart .recharts-sector")).toHaveCount(3);
  for (const label of ["50.2%", "48.5%", "1.3%", "62.7%", "27.1%", "9.5%", "3.2%"]) await expect(page.locator(".overview-demographics").getByText(label, { exact: true })).toBeVisible();
  await expect(page.locator(".overview-peak").getByText("10–11 AM", { exact: true })).toBeVisible();
  await expect(page.locator(".overview-peak").getByText("156 people", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mock-dashboard-collapsed.png"), fullPage: true });

  await page.getByRole("button", { name: "Open TANAW AI Assistant" }).click();
  const assistant = page.getByRole("complementary", { name: "TANAW AI Assistant" });
  await expect(assistant.getByRole("log")).toContainText("today's entries total 1,248");
  await assistant.getByRole("button", { name: "When are our busiest hours?", exact: true }).click();
  await expect(assistant.getByRole("log")).toContainText("185 entries and 115 exits");
  await assistant.getByRole("textbox").fill("unrecognized question");
  await assistant.getByRole("button", { name: "Send message" }).click();
  await expect(assistant.getByRole("log")).toContainText("This is an offline sample conversation");
  await page.screenshot({ path: testInfo.outputPath("mock-dashboard-expanded.png"), fullPage: true });
  await page.getByRole("button", { name: "Collapse TANAW AI Assistant" }).click();
  await page.getByRole("button", { name: "Open TANAW AI Assistant" }).click();
  await expect(assistant.getByRole("log")).toContainText("unrecognized question");
  await page.getByRole("button", { name: "Collapse TANAW AI Assistant" }).click();

  const recent = page.locator(".overview-reports");
  await recent.getByRole("button", { name: /Tourism Report - Nov 7/ }).click();
  const preview = page.getByRole("dialog", { name: "Sample report preview", exact: true });
  await expect(preview).toContainText("This report is not saved or submitted");
  await expect(preview.getByRole("button", { name: /Submit|Download|Export/i })).toHaveCount(0);
  await preview.getByRole("button", { name: "Close Sample report preview", exact: true }).click();
  await expect(recent).toContainText("Consolidated");
  await expect(recent).toContainText("Returned for Revision");
  await expect(recent.getByRole("button", { name: /Next submitted report|Previous submitted report/ })).toHaveCount(0);
  const reportList = recent.getByRole("region", { name: "Recent report list" });
  await expect(reportList.getByRole("button")).toHaveCount(7);
  await reportList.scrollIntoViewIfNeeded();
  await reportList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(recent.getByRole("button", { name: /Tourism Report - April 2026/ })).toBeInViewport();

  await selectDashboardPeriod(page, "Week");
  await expect(page.locator(".overview-charts .recharts-bar-rectangle")).toHaveCount(14);
  await selectDashboardPeriod(page, "Month");
  await expect(page.locator(".overview-charts .recharts-bar-rectangle")).toHaveCount(60);
  await selectDashboardPeriod(page, "Today");
  for (const width of [1024, 430]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.locator(".overview-main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mock-dashboard-${width}.png`), fullPage: true });
  }
  // Advance beyond both Dashboard polling intervals. A disconnected sidecar must
  // never be contacted while inspecting the mock Dashboard or sample reports.
  await page.clock.install();
  await page.clock.fastForward(20_000);
  expect(state.mlRequests).toEqual([]);
  expect(state.operationalRequests.every((request) => request.method === "GET" && !request.body)).toBe(true);
  const writes = await page.evaluate(() => (window as unknown as { __dashboardStorageWrites: string[] }).__dashboardStorageWrites);
  expect(writes.some((value) => /MOCK-TOURISM|dashboard-sample|185 entries and 115 exits|unrecognized question/.test(value))).toBe(false);
});

test("shares frontend reports while keeping Camera Setup connected to real services", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await setup(page);
  expect(state.mlRequests).toEqual([]);
  await page.getByRole("link", { name: "View All", exact: true }).click();
  await expect(page).toHaveURL(/enterprise\/reports/);
  await expect(page.locator('[data-reports-source="mock"]')).toBeVisible();
  expect(state.mlRequests).toEqual([]);
  await page.getByRole("tab", { name: "Reports History", exact: true }).click();
  await expect(page.locator(".report-history-table-scroll")).toContainText("MOCK-TOURISM-2026-1107");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator('[data-dashboard-source="mock"]')).toBeVisible();
  await page.getByRole("button", { name: "Camera Setup", exact: true }).click();
  await expect(page).toHaveURL(/enterprise\/cameras/);
  await expect(page.getByRole("heading", { name: "Camera service unavailable" })).toBeVisible();
  await expect(page.locator('[data-dashboard-source="mock"]')).toHaveCount(0);
  expect(state.operationalRequests.every((request) => request.method === "GET")).toBe(true);
});

test("Reports preview, popups, steps and synchronized samples work without services", async ({ page }, info) => {
  test.setTimeout(120_000);
  const state = await setup(page);
  await verifyReportsPolish(page, info);
  await verifyFinalReports(page, info);
  expect(state.mlRequests).toEqual([]);
  expect(state.operationalRequests.every((request) => request.method === "GET")).toBe(true);
  const writes = await page.evaluate(() => (window as unknown as { __dashboardStorageWrites: string[] }).__dashboardStorageWrites);
  expect(writes.some((value) => /MOCK-TOURISM|MOCK-DRAFT|reports-sample/.test(value))).toBe(false);
});

test("keeps Dashboard focus green, keyboard navigation intact, and assistant scrolling contained", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await setup(page);
  const date = page.getByRole("combobox", { name: "Dashboard date range" });
  await date.focus();
  await date.press("Enter");
  await expect(page.getByRole("listbox", { name: "Dashboard date range" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("dashboard-themed-date-menu.png"), fullPage: true });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(date).toContainText("Past 30 days");
  await expect(date).toBeFocused();
  await date.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(date).toBeFocused();
  await date.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listbox", { name: "Dashboard date range" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Month visitor entries and exits" })).toBeFocused();
  await selectDashboardPeriod(page, "Today");

  for (const name of ["Today visitor entries and exits", "Today establishment peak occupancy history"]) {
    const chart = page.getByRole("img", { name, exact: true });
    await chart.focus();
    await chart.press("ArrowRight");
    await expect.poll(() => chart.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
    await expect(page.getByRole("tooltip").first()).toBeVisible();
    expect(await chart.evaluate((element) => element.getAttribute("tabindex"))).toBe("0");
  }
  await page.locator(".overview-charts .recharts-bar-rectangle").nth(2).hover();
  await expect(page.getByRole("tooltip").first()).toContainText("Entries");
  await expect(page.getByRole("tooltip").first()).toContainText("Exits");
  await page.screenshot({ path: testInfo.outputPath("dashboard-professional-tooltip.png"), fullPage: true });
  const donut = page.locator(".tanaw-demographics-chart .recharts-surface");
  await donut.focus();
  await expect(donut).toBeFocused();
  await expect(donut).toHaveCSS("outline-style", "none");
  await page.locator(".demographic-legend li").first().focus();
  await expect(page.locator(".donut-tooltip")).toContainText("Female");
  const metric = page.locator('[data-metric-segment="occupancy"]');
  const before = await metric.boundingBox();
  await metric.hover();
  const after = await metric.boundingBox();
  expect(after!.width).toBeCloseTo(before!.width, 1);
  expect(after!.height).toBeCloseTo(before!.height, 1);
  await page.screenshot({ path: testInfo.outputPath("dashboard-clean-chart-focus.png"), fullPage: true });

  await page.getByRole("button", { name: "Open TANAW AI Assistant" }).click();
  const assistant = page.getByRole("complementary", { name: "TANAW AI Assistant" });
  const input = assistant.getByRole("textbox");
  const form = assistant.locator("form");
  const originalHeight = (await form.boundingBox())!.height;
  await input.click();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(input).toHaveCSS("box-shadow", "none");
  await expect(input).toHaveCSS("border-top-width", "0px");
  await expect(form).toHaveCSS("border-radius", "24px");
  expect((await form.boundingBox())!.height).toBeCloseTo(originalHeight, 1);
  await expect(form).not.toHaveCSS("box-shadow", "none");
  const main = page.locator(".enterprise-content");
  const initialScroll = await main.evaluate((element) => element.scrollTop);
  for (let index = 0; index < 23; index++) {
    await input.fill("Scrolling test " + index);
    await input.press("Enter");
  }
  const conversation = assistant.getByRole("log");
  await expect(conversation.locator(".assistant-exchange")).toHaveCount(20);
  await expect.poll(() => conversation.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
  expect(await main.evaluate((element) => element.scrollTop)).toBe(initialScroll);
  await page.screenshot({ path: testInfo.outputPath("assistant-clean-composer.png"), fullPage: true });
  await page.getByRole("button", { name: "Collapse TANAW AI Assistant" }).click();
  await expect(page.getByRole("button", { name: "Open TANAW AI Assistant" })).toBeFocused();
  await page.getByRole("button", { name: "Open TANAW AI Assistant" }).press("Enter");
  await expect(assistant.getByRole("log")).toContainText("Scrolling test 22");
  await expect(input).toBeFocused();
  await expect(page.locator(".overview-layout")).toHaveCSS("transition-duration", "0s");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await input.click();
  await expect(input).toHaveCSS("box-shadow", "none");
  await expect(form).toHaveCSS("border-color", "rgb(166, 205, 187)");
  await date.click();
  await expect(page.locator(".dashboard-date-menu")).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("dashboard-dark-focus-and-menu.png"), fullPage: true });
  await page.keyboard.press("Escape");
  expect(state.mlRequests).toEqual([]);
});

test("animates assistant opening and closing and shows exactly five report rows before scrolling", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setup(page);
  const gridWidth = () => page.locator(".overview-layout").evaluate((element) => parseFloat(getComputedStyle(element).gridTemplateColumns.split(" ").at(-1)!));
  await Promise.all([
    page.waitForFunction(() => {
      const layout = document.querySelector(".overview-layout")!;
      const width = parseFloat(getComputedStyle(layout).gridTemplateColumns.split(" ").at(-1)!);
      return width > 0 && width < 299;
    }),
    page.getByRole("button", { name: "Open TANAW AI Assistant" }).click(),
  ]);
  await expect.poll(gridWidth).toBe(300);
  await page.getByRole("complementary", { name: "TANAW AI Assistant" }).getByRole("textbox").fill("Hello");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await Promise.all([
    page.waitForFunction(() => {
      const layout = document.querySelector(".overview-layout")!;
      const width = parseFloat(getComputedStyle(layout).gridTemplateColumns.split(" ").at(-1)!);
      return width > 0 && width < 299;
    }),
    page.getByRole("button", { name: "Collapse TANAW AI Assistant" }).click(),
  ]);
  await expect.poll(gridWidth).toBe(0);
  const list = page.getByRole("region", { name: "Recent report list" });
  await list.scrollIntoViewIfNeeded();
  const rows = list.locator(".recent-report-row");
  const visibleRows = () =>
    list.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll(".recent-report-row")].filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
      }).length;
    });
  await expect.poll(visibleRows).toBe(5);
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.focus();
  await list.press("End");
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await rows.last().click();
  await expect(page.getByRole("dialog", { name: "Sample report preview" })).toContainText("April 2026");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("reports-scroll-five-rows.png"), fullPage: true });
  await page.setViewportSize({ width: 430, height: 1000 });
  await list.evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(visibleRows).toBe(5);
  await expect.poll(() => page.locator(".overview-main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard-scroll-list-mobile.png"), fullPage: true });
});
