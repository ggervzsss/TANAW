import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeMlSidecar } from "./support/fake-ml-sidecar";

test("Dashboard chart clicks never paint native SVG focus rectangles in Electron", async ({ playwright }, testInfo) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(path.join(tmpdir(), "tanaw-dashboard-ui-"));
  const sidecar = new FakeMlSidecar();
  sidecar.respond = (request) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/metrics/establishment/live")
      return { status: 200, body: { enterprise_id: "enterprise-1", occupancy: 12, partial_occupancy: 12, state: "estimated", contributions: [], missing_camera_ids: [], excluded_camera_ids: [] } };
    if (url.pathname !== "/metrics/establishment/summary") return undefined;
    const start = url.searchParams.get("start")!;
    const end = url.searchParams.get("end")!;
    const length = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
    const days = Array.from({ length }, (_, index) => ({
      business_date: new Date(Date.parse(start) + index * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 10),
      covered_ms: 86_400_000,
      qualified_observations: 40,
      identification_state: "available",
      unique_count: 40,
      peak_occupancy: 18 + index,
      entries: 50 + index,
      exits: 35 + index,
      movement_state: "available",
    }));
    return {
      status: 200,
      body: {
        enterprise_id: "enterprise-1",
        from_at: start,
        to_at: end,
        days,
        days_available: length,
        days_requested: length,
        unique_count: 40 * length,
        confirmed_unique_count: 40 * length,
        entries: days.reduce((sum, day) => sum + day.entries, 0),
        exits: days.reduce((sum, day) => sum + day.exits, 0),
        peak_occupancy: 17 + length,
        reconciliation_state: "estimated",
        movement_state: "available",
        identification_state: "available",
        coverage_ratio: 1,
        unresolved_observations: 0,
        source_breakdown: [],
      },
    };
  };
  await sidecar.start();
  let application: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { APPDATA: directory, LOCALAPPDATA: directory, TANAW_ML_SERVICE_PORT: String(sidecar.port) });
    application = await playwright._electron.launch({ args: [".", `--user-data-dir=${path.join(directory, "profile")}`], env });
    const context = application.context();
    const user = {
      id: "dashboard-ui-operator",
      name: "Dashboard UI Operator",
      email: "dashboard@example.test",
      role: "enterprise",
      enterpriseId: "enterprise-1",
      enterpriseName: "Tourism UI Preview",
    };
    await context.route("http://localhost:8000/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const body =
        pathname === "/auth/login" || pathname === "/auth/session"
          ? { token: "dashboard-ui-test-session", user }
          : pathname === "/auth/me"
            ? user
            : pathname === "/auth/system-settings"
              ? { values: { "display.timeFormat": "12-hour" } }
              : [];
      return route.fulfill({ json: body });
    });
    await context.routeWebSocket("**/realtime/ws", (socket) =>
      socket.onMessage((message) => {
        if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
      }),
    );
    await expect.poll(() => application?.windows().some((page) => page.url().startsWith("tanaw-app://desktop"))).toBe(true);
    const page = application.windows().find((page) => page.url().startsWith("tanaw-app://desktop"))!;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("tanaw-app://desktop/index.html#/login");
    await page.getByPlaceholder("Enter username or registered email").fill(user.email);
    await page.getByPlaceholder("Enter your password").fill("Dashboard test session password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".overview-layout")).toBeVisible();
    // Use the desktop's maximized layout throughout; the splash can otherwise
    // resize a window during a geometry assertion in an automated launch.
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("tanaw-app://desktop"));
      window?.maximize();
      window?.show();
    });
    await expect
      .poll(() =>
        application!.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("tanaw-app://desktop"));
          return window?.isVisible() && window.isMaximized();
        }),
      )
      .toBe(true);
    await page.getByRole("button", { name: /^Dashboard date range/ }).click();
    const picker = page.getByRole("dialog", { name: "Choose the dates to show" });
    await picker.getByRole("radio", { name: "Last 7 days", exact: true }).click();
    await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect.poll(() => sidecar.requestPaths.filter((pathname) => pathname === "/metrics/establishment/summary").length).toBeGreaterThan(0);
    // 50 + 51 + … + 56 entries across the week.
    await expect(page.locator('[data-metric-segment="entries"] strong')).toHaveText("371");
    const chart = page.locator(".dash-plot");
    await expect(chart).toHaveCount(1);
    const readout = page.locator(".dash-readout");
    const assertCleanClick = async () => {
      const focus = await page.evaluate(() => {
        const element = document.activeElement!;
        const style = getComputedStyle(element);
        return { tag: element.tagName, classes: element.getAttribute("class"), outlineStyle: style.outlineStyle };
      });
      expect(focus.outlineStyle, JSON.stringify(focus)).toBe("none");
    };
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      await chart.scrollIntoViewIfNeeded();
      const before = await chart.boundingBox();
      const columns = chart.locator(".dash-hit");
      await expect(columns).toHaveCount(7);
      await expect(chart.locator(".dash-bar")).toHaveCount(7);
      for (const column of [0, 2, 5]) {
        await columns.nth(column).click();
        await assertCleanClick();
        await expect(columns.nth(column)).toHaveAttribute("aria-pressed", "true");
        await expect(chart.locator(".dash-bar-selected")).toHaveCount(1);
      }
      // Pointing at the chart dims every bar except the one under the pointer.
      await columns.nth(3).hover();
      await expect(chart.locator(".dash-bar").nth(0)).not.toHaveCSS("opacity", "1");
      await expect(chart.locator(".dash-bar-selected")).toHaveCSS("opacity", "1");
      // Keyboard: the date control is followed by the chart, and arrows move between days.
      await page.getByRole("button", { name: /^Dashboard date range/ }).focus();
      await page.keyboard.press("Tab");
      await expect(chart).toBeFocused();
      const shown = await readout.textContent();
      await page.keyboard.press("ArrowLeft");
      await expect(readout).not.toHaveText(shown ?? "");
      await expect(chart).toHaveCSS("outline-style", "solid");
      expect(await chart.boundingBox()).toEqual(before);
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${theme}-chart-keyboard.png`) });
      await columns.nth(2).click();
      await assertCleanClick();
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${theme}-chart-clicked.png`) });
    }
    await page.getByRole("button", { name: "Open TANAW Insights" }).click();
    const assistant = page.getByRole("complementary", { name: "TANAW Insights" });
    const input = assistant.getByRole("textbox");
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("box-shadow", "none");
    await input.fill("What insights can you give me?");
    await assistant.getByRole("button", { name: "Send message" }).click();
    await expect(assistant.getByRole("log")).toContainText("What insights can you give me?");
    await expect(assistant.getByRole("log")).toContainText("TANAW recorded about");
    await expect(assistant.getByRole("log")).toHaveAttribute("aria-busy", "false");
    await page.screenshot({ path: testInfo.outputPath(`dashboard-assistant-expanded.png`) });
    await page.getByRole("button", { name: "Collapse TANAW Insights" }).click();
    await expect(page.getByRole("button", { name: "Open TANAW Insights" })).toBeFocused();
    expect(sidecar.requestPaths).toContain("/reports/local");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // The panel docks over the page against the right edge: the dashboard keeps its width underneath it.
    const mainWidth = () => page.locator(".dash-main").evaluate((element) => element.getBoundingClientRect().width);
    const widthBefore = await mainWidth();
    await page.getByRole("button", { name: "Open TANAW Insights" }).click();
    await expect(assistant).toBeVisible();
    await expect(assistant).toHaveCSS("position", "fixed");
    await expect
      .poll(async () => {
        const box = await assistant.boundingBox();
        return Math.round((box?.x ?? 0) + (box?.width ?? 0));
      })
      .toBe(await page.evaluate(() => window.innerWidth));
    expect(await mainWidth()).toBe(widthBefore);
    await page.getByRole("button", { name: "Collapse TANAW Insights" }).click();
    await expect(assistant).toHaveCount(0);
  } finally {
    if (application) await application.close();
    await sidecar.stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
