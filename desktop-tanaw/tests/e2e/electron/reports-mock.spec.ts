import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeMlSidecar } from "./support/fake-ml-sidecar";
import { verifyReportsPolish } from "../support/reports-polish";
import { verifyFinalReports } from "../support/reports-final";

test("Reports mock workflow remains local and polished in Electron", async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), "tanaw-reports-mock-"));
  const sidecar = new FakeMlSidecar();
  await sidecar.start();
  let app: ElectronApplication | undefined;
  const writes: string[] = [];
  try {
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { APPDATA: directory, LOCALAPPDATA: directory, TANAW_ML_SERVICE_PORT: String(sidecar.port) });
    app = await playwright._electron.launch({ args: [".", `--user-data-dir=${path.join(directory, "profile")}`], env });
    const user = { id: "mock-operator", name: "Reports UI Operator", email: "reports@example.test", role: "enterprise", enterpriseId: "enterprise-1", enterpriseName: "Tourism UI Preview" };
    await app.context().route("http://localhost:8000/**", (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" && !url.pathname.startsWith("/auth")) writes.push(route.request().postData() ?? "");
      return route.fulfill({
        json:
          url.pathname === "/auth/login" || url.pathname === "/auth/session"
            ? { token: "reports-test", user }
            : url.pathname === "/auth/me"
              ? user
              : url.pathname === "/auth/system-settings"
                ? { values: {} }
                : [],
      });
    });
    await app.context().routeWebSocket("**/realtime/ws", (socket) =>
      socket.onMessage((message) => {
        if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
      }),
    );
    await expect.poll(() => app!.windows().some((page) => page.url().startsWith("tanaw-app://desktop"))).toBe(true);
    const page = app.windows().find((page) => page.url().startsWith("tanaw-app://desktop"))!;
    await page.clock.install({ time: new Date("2026-11-15T02:00:00Z") });
    await page.goto("tanaw-app://desktop/index.html#/login");
    await page.getByPlaceholder("Enter username or registered email").fill(user.email);
    await page.getByPlaceholder("Enter your password").fill("Mock test session password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-dashboard-source="mock"]')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().startsWith("tanaw-app://desktop"))
        ?.show(),
    );
    await verifyReportsPolish(page, info);
    await verifyFinalReports(page, info);
    const directDownload = app.evaluate(
      ({ BrowserWindow }) =>
        new Promise<string>((resolve) => {
          const window = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith("tanaw-app://desktop"))!;
          window.webContents.session.once("will-download", (_event, item) => {
            const filename = item.getFilename();
            item.cancel();
            resolve(filename);
          });
        }),
    );
    await page
      .locator(".report-history-table-scroll tbody tr")
      .filter({ hasText: "October 2026" })
      .getByRole("button", { name: /^Download / })
      .click();
    expect(await directDownload).toContain("MOCK-TOURISM-2026-1107");
    await expect(page.getByRole("dialog", { name: "Review Report Form", exact: true })).not.toBeVisible();
    await page
      .locator(".report-history-table-scroll tbody tr")
      .filter({ hasText: "MOCK-DRAFT-2026-11" })
      .getByRole("button", { name: /^View / })
      .click();
    const exported = info.outputPath("MOCK-DRAFT-VAR1.pdf");
    await app.evaluate(({ BrowserWindow }, destination) => {
      const window = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith("tanaw-app://desktop"))!;
      window.webContents.session.once("will-download", (_event, item) => item.setSavePath(destination));
    }, exported);
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    await expect.poll(async () => (await stat(exported).catch(() => null))?.size ?? 0).toBeGreaterThan(1000);
    expect(await readFile(exported, "utf8")).toContain("MOCK-DRAFT-2026-11");
    await page.keyboard.press("Escape");
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().startsWith("tanaw-app://desktop"))!
          .webContents.getZoomFactor(),
      ),
    ).toBe(1);
    expect(sidecar.requestPaths.filter((url) => /\/reports\/(drafts|local-submit)/.test(url))).toEqual([]);
    expect(writes).toEqual([]);
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("region", { name: "Recent report list" })).toContainText("MOCK-TOURISM-2026-1107");
  } finally {
    if (app) await app.close();
    await sidecar.stop();
    await cleanup(directory);
  }
});

async function cleanup(directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("tanaw-reports-mock-")) throw new Error("Unexpected profile path");
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
