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
    await page.getByRole("combobox", { name: "Dashboard date range" }).click();
    await page.getByRole("option", { name: "Past 7 days" }).click();
    await expect.poll(() => sidecar.requestPaths.filter((pathname) => pathname === "/metrics/establishment/summary").length).toBeGreaterThan(0);
    await expect(page.locator('[data-metric-segment="visitors"] strong')).toHaveText("280");
    const charts = page.locator(".overview-chart-canvas");
    await expect(charts).toHaveCount(2);
    const assertCleanClick = async () => {
      const focus = await page.evaluate(() => {
        const element = document.activeElement!;
        const style = getComputedStyle(element);
        return { tag: element.tagName, classes: element.getAttribute("class"), tabIndex: element.getAttribute("tabindex"), outline: style.outline, outlineStyle: style.outlineStyle };
      });
      expect(focus.classes).toMatch(/recharts/);
      expect(focus.outlineStyle, JSON.stringify(focus)).toBe("none");
    };
    // Exercise both mouse-focused SVG portal groups and the keyboard surface.
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      for (let index = 0; index < 2; index += 1) {
        const chart = charts.nth(index);
        const before = await chart.boundingBox();
        await chart.scrollIntoViewIfNeeded();
        const marks = chart.locator(index === 0 ? ".recharts-bar-rectangle path, .recharts-active-bar path" : ".recharts-area-dot");
        let positions: Array<{ x: number; y: number }> = [];
        // SVG layout catches up with theme and responsive-container changes on
        // the next frame. Wait for actual painted marks before clicking them.
        await expect
          .poll(
            async () => {
              positions = await marks.evaluateAll((elements) =>
                elements
                  .map((element) => {
                    const bounds = element.getBoundingClientRect();
                    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: bounds.width, height: bounds.height };
                  })
                  .filter((bounds) => bounds.width > 0 && bounds.height > 0),
              );
              return positions.length;
            },
            { message: `${theme} chart ${index} painted data marks` },
          )
          .toBeGreaterThanOrEqual(6);
        const clickMark = async (mark: number) => {
          // Recharts replaces a hovered bar with its active shape in another
          // portal. Click the real screen position rather than retrying a now
          // empty DOM group while that replacement happens under the pointer.
          await page.mouse.click(positions[mark].x, positions[mark].y);
        };
        for (const mark of [0, 2, 5]) {
          await clickMark(mark);
          await assertCleanClick();
          await expect(chart.getByRole("tooltip")).toBeVisible();
        }
        if (index === 1) {
          const point = await chart.locator(".recharts-area-curve").evaluate((element) => {
            const path = element as SVGPathElement;
            const point = path.getPointAtLength(path.getTotalLength() * 0.4);
            const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
            return { x: screenPoint.x, y: screenPoint.y };
          });
          await page.mouse.click(point.x, point.y);
          await assertCleanClick();
        }
        const surface = chart.locator('.recharts-surface[tabindex="0"]');
        for (const fraction of [0.15, 0.5, 0.9]) {
          const size = await surface.boundingBox();
          await surface.click({ position: { x: size!.width * fraction, y: size!.height - 45 } });
          await assertCleanClick();
        }
        // The library's internal -1 groups stay out of the Tab order.
        await page.getByRole("combobox", { name: "Dashboard date range" }).focus();
        await page.keyboard.press("Tab");
        if (index === 1) await page.keyboard.press("Tab");
        await expect(surface).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await expect(chart.getByRole("tooltip")).toBeVisible();
        expect(await chart.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
        await expect(surface).toHaveCSS("outline-style", "none");
        expect(await chart.boundingBox()).toEqual(before);
        await page.screenshot({ path: testInfo.outputPath(`dashboard-${theme}-chart-${index}-keyboard.png`) });
        await clickMark(2);
        await assertCleanClick();
        expect(await chart.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
        await page.screenshot({ path: testInfo.outputPath(`dashboard-${theme}-chart-${index}-clicked.png`) });
      }
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
    await page.getByRole("button", { name: "Open TANAW Insights" }).click();
    await expect(assistant).toBeVisible();
    expect(await page.locator(".overview-layout").evaluate((element) => getComputedStyle(element).transitionDuration)).toContain("0.32s");
    await page.getByRole("button", { name: "Collapse TANAW Insights" }).click();
    await expect(assistant).toHaveCount(0);
  } finally {
    if (application) await application.close();
    await sidecar.stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
