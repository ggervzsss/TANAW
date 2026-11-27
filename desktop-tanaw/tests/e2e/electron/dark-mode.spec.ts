import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeMlSidecar } from "./support/fake-ml-sidecar";
import { themeServiceFixture, themeUser } from "../support/theme-fixture";
import { switchTheme, verifyThemeAndFilters } from "../support/theme-and-filters";

test("desktop dark theme, camera dialogs and automatic report filtering preserve layout", async ({ playwright }, info) => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(path.join(tmpdir(), "tanaw-theme-ui-"));
  const sidecar = new FakeMlSidecar(),
    respond = themeServiceFixture();
  sidecar.respond = async (request) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    return respond({ url: request.url ?? "/", method: request.method, body: body || undefined });
  };
  await sidecar.start();
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { APPDATA: directory, LOCALAPPDATA: directory, TANAW_ML_SERVICE_PORT: String(sidecar.port) });
    app = await playwright._electron.launch({ args: [".", `--user-data-dir=${path.join(directory, "profile")}`], env });
    const context = app.context();
    await context.route("**/auth/**", (route) => {
      const endpoint = new URL(route.request().url()).pathname;
      return route.fulfill({ json: endpoint.endsWith("/me") ? themeUser : endpoint.endsWith("system-settings") ? { values: {} } : { token: "theme-session", user: themeUser } });
    });
    await context.route("**/operational/**", (route) => route.fulfill({ json: [] }));
    await context.routeWebSocket("**/realtime/ws", (socket) =>
      socket.onMessage((message) => {
        if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
      }),
    );
    await expect.poll(() => app!.windows().some((page) => page.url().startsWith("tanaw-app://desktop"))).toBe(true);
    const page = app.windows().find((page) => page.url().startsWith("tanaw-app://desktop"))!;
    await page.clock.install({ time: new Date("2026-11-15T02:00:00Z") });
    await page.goto("tanaw-app://desktop/index.html#/login");
    await page.getByPlaceholder("Enter username or registered email").fill(themeUser.email);
    await page.getByPlaceholder("Enter your password").fill("Theme test password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("tanaw-app://desktop"));
      window?.show();
    });
    await page.getByRole("button", { name: "Open account menu" }).click();
    await page.getByRole("button", { name: "General Settings" }).click();
    await page.getByRole("button", { name: "Password & Security" }).click();
    const currentPassword = page.getByLabel("Current Password", { exact: true });
    await currentPassword.focus();
    await currentPassword.fill("Unsaved password input");
    await page.getByRole("button", { name: "Appearance" }).click();
    const discard = page.getByRole("dialog", { name: "Discard unsaved settings?" });
    await discard.getByRole("button", { name: "Keep editing" }).click();
    await expect(currentPassword).toHaveValue("Unsaved password input");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Dark Mode" }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.getByRole("button", { name: "Back from General Settings" }).click();
    await verifyThemeAndFilters(page, info, false);
    for (const size of [
      { width: 1918, height: 980 },
      { width: 1100, height: 760 },
    ]) {
      await page.setViewportSize(size);
      for (const theme of ["dark", "light"] as const) {
        const dark = await page.locator("html").evaluate((node) => node.classList.contains("dark"));
        if (dark !== (theme === "dark")) {
          await switchTheme(page, theme);
          await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
        }
        for (const destination of ["Dashboard", "Reports", "Camera Setup"]) {
          if (!(await page.getByRole("button", { name: destination, exact: true }).isVisible())) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
          await page.getByRole("button", { name: destination, exact: true }).click();
          await expect(page.getByRole("navigation", { name: "Enterprise mobile navigation", exact: true })).toHaveCount(0);
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
          await page.screenshot({ path: info.outputPath(`${theme}-${destination.replaceAll(" ", "-")}-${size.width}.png`), fullPage: true });
          if (destination === "Camera Setup") {
            await page.getByRole("button", { name: "Edit configuration" }).click();
            await page.screenshot({ path: info.outputPath(`${theme}-Camera-Settings-${size.width}.png`), fullPage: true });
            await page.getByRole("region", { name: "Camera Settings", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
          }
        }
      }
    }
  } finally {
    await app?.close();
    await sidecar.stop();
    await cleanup(directory);
  }
});
async function cleanup(directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("tanaw-theme-ui-")) throw new Error("Unexpected theme test cleanup directory");
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
