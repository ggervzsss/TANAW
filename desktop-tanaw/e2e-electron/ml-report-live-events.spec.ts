import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { MlReportLiveEvent } from "../src/types/ml-report-live-events";
import { FakeMlSidecar } from "./support/fake-ml-sidecar";

test.describe.configure({ mode: "serial" });

test("mediates authenticated report events across preload and IPC", async () => {
  const sidecar = new FakeMlSidecar();
  await sidecar.start();
  let electronApp: ElectronApplication | undefined;

  try {
    electronApp = await electron.launch({
      args: [".", "--headless", "--no-sandbox"],
      env: { ...process.env, TANAW_ML_SERVICE_PORT: String(sidecar.port) },
    });
    const page = await getMainWindow(electronApp);
    await expectBridge(page);
    expect(await rendererConnectSources(page)).toEqual(["'self'", "http://localhost:8000", "ws://localhost:8000"]);
    await expect.poll(() => sidecar.requestTokens.length).toBeGreaterThan(0);

    const exposedApi = await page.evaluate(async () => ({
      keys: Object.keys(window.tanawMlService ?? {}).sort(),
      status: await window.tanawMlService?.getStatus(),
    }));
    expect(exposedApi.keys).toEqual(["getStatus", "request", "restart", "stopCamera", "subscribeToReportEvents"]);
    expect(Object.keys(exposedApi.status ?? {})).not.toContain("accessToken");
    expect(JSON.stringify(exposedApi)).not.toContain(sidecar.requestTokens[0]);
    const cameraRuntimeResponse = await page.evaluate(async () => {
      const status = await window.tanawMlService?.getStatus();
      return window.tanawMlService?.request({ method: "GET", timeoutMs: 1000, url: `${status?.baseUrl}/cameras/runtime` });
    });
    expect(cameraRuntimeResponse?.ok).toBe(true);
    await expect(page.evaluate(() => window.tanawMlService?.request({ method: "GET", timeoutMs: 1000, url: "https://attacker.invalid/camera/ws" }))).rejects.toThrow(/not allowed/i);

    await subscribeInRenderer(page);
    await expect.poll(() => sidecar.activeWebSockets).toBe(1);
    expect(sidecar.webSocketTokens[sidecar.webSocketTokens.length - 1]).toBeTruthy();
    expect(sidecar.webSocketTokens[sidecar.webSocketTokens.length - 1]).toBe(sidecar.requestTokens[sidecar.requestTokens.length - 1]);
    sidecar.sendReportEvent();
    await expect.poll(() => cameraEventCount(page)).toBe(1);

    await page.evaluate(() => window.__tanawReportUnsubscribe?.());
    await expect.poll(() => sidecar.activeWebSockets).toBe(0);
    sidecar.sendReportEvent();
    await expect.poll(() => cameraEventCount(page)).toBe(1);

    await subscribeInRenderer(page);
    await expect.poll(() => sidecar.activeWebSockets).toBe(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectBridge(page);
    await expect.poll(() => sidecar.activeWebSockets).toBe(0);
    await subscribeInRenderer(page);
    await expect.poll(() => sidecar.activeWebSockets).toBe(1);
    sidecar.sendReportEvent();
    await expect.poll(() => cameraEventCount(page)).toBe(1);

    const attemptsBeforeRestart = sidecar.webSocketAttempts;
    await sidecar.restart();
    await expect.poll(() => sidecar.webSocketAttempts, { timeout: 8000 }).toBeGreaterThan(attemptsBeforeRestart);
    await expect.poll(() => sidecar.activeWebSockets, { timeout: 8000 }).toBe(1);
    sidecar.sendReportEvent();
    await expect.poll(() => cameraEventCount(page)).toBe(2);

    await page.evaluate(() => window.__tanawReportUnsubscribe?.());
    await expect.poll(() => sidecar.activeWebSockets).toBe(0);
    sidecar.rejectWebSockets = true;
    const attemptsBeforeRejection = sidecar.webSocketAttempts;
    await subscribeInRenderer(page);
    await expect.poll(() => sidecar.webSocketAttempts).toBe(attemptsBeforeRejection + 1);
    await page.waitForTimeout(2500);
    expect(sidecar.webSocketAttempts).toBe(attemptsBeforeRejection + 1);
    await page.evaluate(() => window.__tanawReportUnsubscribe?.());

    const backendRequests = await configureBackendRoutes(page);
    const metricsRequestsBeforeLogin = sidecar.requestPaths.filter((path) => path === "/metrics/summary").length;
    await page.goto("tanaw-app://desktop/index.html#/login", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Enter username or registered email").fill("enterprise@example.com");
    await page.getByPlaceholder("Enter your password").fill("Enterprise login passphrase 2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/#\/enterprise\/dashboard$/);
    await expect.poll(() => sidecar.requestPaths.filter((path) => path === "/metrics/summary").length).toBeGreaterThan(metricsRequestsBeforeLogin);
    await expect.poll(() => backendRequests.telemetryPosts).toBeGreaterThan(0);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().startsWith("tanaw-app://desktop"))
        ?.destroy();
    });
    await expect.poll(() => sidecar.activeWebSockets).toBe(0);
  } finally {
    if (electronApp) {
      await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    }
    await sidecar.stop();
  }
});

async function getMainWindow(electronApp: ElectronApplication) {
  await expect.poll(() => electronApp.windows().some((candidate) => candidate.url().startsWith("tanaw-app://desktop"))).toBe(true);
  return electronApp.windows().find((candidate) => candidate.url().startsWith("tanaw-app://desktop")) as Page;
}

async function expectBridge(page: Page) {
  await page.waitForFunction(() => typeof window.tanawMlService?.subscribeToReportEvents === "function");
}

async function rendererConnectSources(page: Page) {
  return page.evaluate(() => {
    const policy = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content ?? "";
    const directive = policy
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("connect-src "));
    return directive?.split(/\s+/).slice(1) ?? [];
  });
}

async function subscribeInRenderer(page: Page) {
  await page.evaluate(() => {
    window.__tanawReportEvents = [];
    window.__tanawReportUnsubscribe = window.tanawMlService?.subscribeToReportEvents((event) => window.__tanawReportEvents?.push(event));
  });
}

async function cameraEventCount(page: Page) {
  return page.evaluate(() => window.__tanawReportEvents?.filter((event) => event.type === "camera.states").length ?? 0);
}

async function configureBackendRoutes(page: Page) {
  const requests = { telemetryPosts: 0 };
  const enterpriseUser = {
    id: "enterprise-account-1",
    name: "Electron Test Enterprise",
    displayName: "Electron Test Enterprise",
    email: "enterprise@example.com",
    role: "enterprise",
    title: "Enterprise Account",
    enterpriseId: "enterprise-1",
    enterpriseName: "Electron Test Enterprise",
    buildingCapacity: 100,
  };
  await page.route("http://localhost:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/login") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "electron-test-session", user: enterpriseUser }) });
      return;
    }
    if (path === "/auth/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(enterpriseUser) });
      return;
    }
    if (path === "/operational/desktop/sample-preparation") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
      return;
    }
    if (path === "/operational/desktop/telemetry") requests.telemetryPosts += 1;
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return requests;
}

declare global {
  interface Window {
    __tanawReportEvents?: MlReportLiveEvent[];
    __tanawReportUnsubscribe?: () => void;
  }
}
