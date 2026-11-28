import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeMlSidecar } from "./support/fake-ml-sidecar";

test("Camera Setup works in Electron and draft connection tests never overwrite saved credentials", async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), "tanaw-camera-ui-"));
  const sidecar = new FakeMlSidecar();
  let profiles: Record<string, unknown>[] = [
    {
      id: 1,
      name: "Tapo Camera",
      zone: "Park",
      status: "stopped",
      cameraBrand: "tapo",
      cameraHost: "192.168.1.11",
      rtsp: "rtsp://192.168.1.11/stream2",
      analysisMode: "open_space",
      openSpace: {
        zone_id: "main",
        zone_name: "Park area",
        polygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
      },
      confidence: 0.35,
      trackingConfidence: 0.15,
      processingProfile: "auto",
      config: {
        tripwire: 50,
        reverse: false,
        roi: { left: 0, top: 0, width: 100, height: 100 },
        tripwires: { entry: { start: { x: 30, y: 10 }, end: { x: 30, y: 90 } }, exit: { start: { x: 70, y: 10 }, end: { x: 70, y: 90 } } },
      },
    },
  ];
  const requests: Record<string, unknown>[] = [];
  sidecar.respond = async (request) => {
    const endpoint = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (endpoint === "/cameras") {
      if (request.method === "PUT") {
        let raw = "";
        for await (const chunk of request) raw += chunk.toString();
        profiles = JSON.parse(raw).cameras;
      }
      return { status: 200, body: profiles };
    }
    if (endpoint === "/camera/test") {
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      requests.push(JSON.parse(raw));
      return { status: 200, body: { ok: true, message: "Connection verified by test sidecar" } };
    }
    if (endpoint === "/cameras/runtime")
      return {
        status: 200,
        body: {
          enterprise_id: "enterprise-1",
          enterprise_occupancy: 0,
          pending_camera_ids: [],
          active_camera_count: 0,
          cameras: [
            {
              camera_id: 1,
              counts: { running: false, status: "stopped", entry: null, exit: null, occupancy: null, error: null },
              detections: { frame_width: 0, frame_height: 0, tracks: [] },
              health: { status: "ok", running: false, model_ready: true },
              session: {},
              area: { available: false, presence: null, active_visits: [] },
            },
          ],
        },
      };
    return undefined;
  };
  await sidecar.start();
  let application: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
    Object.assign(env, { APPDATA: directory, LOCALAPPDATA: directory, TANAW_ML_SERVICE_PORT: String(sidecar.port) });
    // Camera passwords need the operating-system keyring, which Playwright disables by default.
    const passwordStore = fileURLToPath(new URL("./support/system-password-store.cjs", import.meta.url));
    application = await playwright._electron.launch({ args: ["-r", passwordStore, ".", `--user-data-dir=${path.join(directory, "profile")}`], env });
    const context = application.context();
    const user = { id: "camera-ui-electron", email: "camera@example.test", role: "enterprise", name: "Camera Operator", enterpriseId: "enterprise-1", enterpriseName: "Camera Workspace" };
    await context.route("http://localhost:8000/**", (route) => {
      const endpoint = new URL(route.request().url()).pathname;
      return route.fulfill({
        json: endpoint === "/auth/me" ? user : ["/auth/login", "/auth/session"].includes(endpoint) ? { token: "camera-ui-session", user } : endpoint === "/auth/system-settings" ? { values: {} } : [],
      });
    });
    await context.routeWebSocket("**/realtime/ws", (socket) =>
      socket.onMessage((message) => {
        if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
      }),
    );
    await expect.poll(() => application!.windows().some((page) => page.url().startsWith("tanaw-app://desktop"))).toBe(true);
    const page = application.windows().find((page) => page.url().startsWith("tanaw-app://desktop"))!;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("tanaw-app://desktop/index.html#/login");
    await page.getByPlaceholder("Enter username or registered email").fill(user.email);
    await page.getByPlaceholder("Enter your password").fill("Camera UI test password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/enterprise\/dashboard/);
    await page.evaluate(() => window.tanawCameraCredentials!.save(1, { username: "saved-user", password: "saved-camera-secret" }));
    await page.getByRole("button", { name: "Camera Setup", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((value) => value.webContents.getURL().startsWith("tanaw-app://desktop"));
      window?.maximize();
      window?.show();
    });
    await expect(page.getByRole("button", { name: /Tapo Camera/, pressed: true })).toBeVisible();
    await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("camera-preview-surface"))).toBe(true);
    await page.getByRole("button", { name: "Exit Fullscreen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((value) => value.webContents.getURL().startsWith("tanaw-app://desktop"));
      if (!window) throw new Error("Camera window not found");
      window.unmaximize();
      // Leave room for native window sizing and renderer zoom rounding across platforms.
      window.setContentSize(1000, 612);
      window.webContents.setZoomFactor(1.25);
    });
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThanOrEqual(500);
    await page.getByRole("button", { name: "Edit configuration" }).click();
    const settings = page.getByRole("region", { name: "Camera Settings", exact: true });
    await expect(settings.getByRole("tab")).toHaveCount(5);
    await expect(page.getByRole("region", { name: "My Cameras" })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(settings.getByRole("button", { name: "Save Changes", exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole("tab", { name: "Connection", exact: true }).click();
    await expect(page.getByLabel("Camera Username", { exact: true })).toHaveValue("saved-user");
    await page.getByLabel("Camera Username", { exact: true }).fill("draft-user");
    await page.getByLabel("Camera Password", { exact: true }).fill("draft-camera-secret");
    await page.getByRole("button", { name: "Test Camera Connection", exact: true }).click();
    await expect(page.getByText("Camera connection verified with these settings.", { exact: false })).toBeVisible();
    expect(requests[0]).toMatchObject({ camera_id: 1, username: "draft-user", password: "draft-camera-secret" });
    expect(await page.evaluate(() => window.tanawCameraCredentials!.load())).toMatchObject({ "1": { username: "saved-user", passwordConfigured: true } });
    await page.screenshot({ path: info.outputPath("electron-camera-connection.png"), fullPage: true });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard Changes" }).click();
    await page.getByRole("button", { name: "Edit configuration" }).click();
    await page.getByLabel("Camera Name", { exact: true }).fill("Saved Park Camera");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByRole("region", { name: "Camera Settings", exact: true })).toHaveCount(0);
    expect(profiles[0].name).toBe("Saved Park Camera");
    expect(JSON.stringify(profiles)).not.toContain("secret");
    await page.screenshot({ path: info.outputPath("electron-camera-setup.png"), fullPage: true });
    expect(sidecar.requestTokens.length).toBeGreaterThan(0);
    expect(new Set(sidecar.requestTokens).size).toBe(1);
  } finally {
    await application?.close();
    await sidecar.stop();
    await removeCameraTestProfile(directory);
  }
});

async function removeCameraTestProfile(directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("tanaw-camera-ui-")) throw new Error("Unexpected camera test cleanup directory");
  await rm(resolved, { recursive: true, force: true });
}
