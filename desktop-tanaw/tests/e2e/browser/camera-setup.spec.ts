import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";
import type { Camera } from "../../../src/types/enterprise";

test.describe.configure({ timeout: 60_000 });

const polygon = [
  { x: 0.15, y: 0.2 },
  { x: 0.85, y: 0.2 },
  { x: 0.85, y: 0.85 },
  { x: 0.15, y: 0.85 },
];
const camera = (id: number): Camera => ({
  id,
  name: id === 1 ? "Tapo Camera" : "Dahua Camera",
  zone: "Park",
  cameraBrand: "tapo",
  cameraHost: `192.168.1.${id + 10}`,
  rtsp: `rtsp://192.168.1.${id + 10}/stream2`,
  analysisMode: "open_space",
  openSpace: { zone_id: "main", zone_name: "Park area", polygon },
  username: "operator",
  status: "running",
  processingProfile: "auto",
  confidence: 0.35,
  trackingConfidence: 0.15,
  config: {
    tripwire: 50,
    reverse: false,
    roi: { left: 0, top: 0, width: 100, height: 100 },
    tripwires: { entry: { start: { x: 30, y: 10 }, end: { x: 30, y: 90 } }, exit: { start: { x: 70, y: 10 }, end: { x: 70, y: 90 } } },
  },
});
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let profiles = [camera(1), camera(2)];
  let status = "running";
  let failTest = false;
  let failWrite = false;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const user = { id: "camera-operator", email: "camera@example.test", role: "enterprise", name: "Camera Operator", enterpriseId: "camera-enterprise", enterpriseName: "Camera Workspace" };
  await page.route("**/auth/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/me") ? user : path.endsWith("system-settings") ? { values: {} } : { token: "camera-ui-test", user } });
  });
  await page.routeWebSocket("**/realtime/ws", (socket) =>
    socket.onMessage((message) => {
      if (typeof message === "string" && JSON.parse(message).type === "auth") socket.send(JSON.stringify({ type: "realtime.ready", heartbeat_seconds: 120 }));
    }),
  );
  await page.route("**/operational/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/camera-test-frame.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#486456"/><path d="M0 300L180 90 640 280V360H0Z" fill="#708579"/><rect x="280" y="70" width="80" height="120" rx="10" fill="#c9d6cc"/></svg>',
    }),
  );
  await page.addInitScript(() => {
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...source,
      set(value: string) {
        source.set!.call(this, value.startsWith("tanaw-ml://") ? new URL("/camera-test-frame.svg", location.origin).href : value);
      },
    });
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return original.call(this, name, this instanceof HTMLImageElement && name === "src" && value.startsWith("tanaw-ml://") ? new URL("/camera-test-frame.svg", location.origin).href : value);
    };
    const records: Record<string, { username: string; passwordConfigured: boolean }> = {
      "1": { username: "operator", passwordConfigured: true },
      "2": { username: "operator", passwordConfigured: true },
    };
    window.tanawCameraCredentials = {
      load: async () => records,
      save: async (id, value) => (records[id] = { username: value.username, passwordConfigured: !!value.password || !!records[id]?.passwordConfigured }),
      remove: async (id) => {
        delete records[id];
      },
      request: async (id, operation, payload) => {
        const response = await window.tanawMlService!.request({
          url: `http://127.0.0.1:8765/camera/${operation}`,
          method: "POST",
          body: JSON.stringify({ ...payload, camera_id: id }),
          timeoutMs: 5000,
        });
        if (!response.ok) throw new Error("Camera service unavailable");
        return JSON.parse(response.body);
      },
    };
  });
  await mockMlRequest(page, "*", (request) => {
    const path = new URL(request.url).pathname;
    const body = JSON.parse(request.body || "{}");
    const reply = (value: unknown, code = 200) => mlResponse({ status: code, body: JSON.stringify(value) });
    const health = {
      status: "ok",
      running: status !== "stopped",
      model_ready: true,
      model_loading: false,
      raw_frame_id: 10,
      raw_frame_stale_ms: 50,
      stream_frame_stale_ms: 50,
      analytics_fps: 12,
      service_version: "test",
      api_contract_version: 2,
      max_configured_cameras: 4,
      max_concurrent_cameras: 4,
    };
    if (path === "/health") return reply(health);
    if (path === "/context/enterprise") return reply({ enterprise_id: user.enterpriseId, changed: false });
    if (path === "/cameras") {
      if (request.method === "PUT") {
        requests.push({ path, body });
        if (failWrite) return reply({ detail: "Camera storage unavailable" }, 503);
        profiles = body.cameras;
      }
      return reply(profiles);
    }
    if (path === "/cameras/runtime")
      return reply({
        enterprise_id: user.enterpriseId,
        pending_camera_ids: [],
        active_camera_count: 2,
        cameras: profiles.map((value) => ({
          camera_id: value.id,
          analysis_mode: value.analysisMode,
          counts: { entry: null, exit: null, occupancy: null, running: status !== "stopped" && status !== "failed", status, error: status === "failed" ? "Camera unreachable" : null },
          detections: { running: true, status, frame_width: 640, frame_height: 360, tracks: [{ track_id: 5, source_track_id: 5, confidence: 0.95, bbox: [280, 70, 360, 190], centroid: [320, 130] }] },
          health,
          area: { available: status === "running", presence: 1, unique_visitors_available: true, unique_visitors: 8, active_visits: [{ track_generation: 5 }], zone_name: value.openSpace?.zone_name },
          session: {},
        })),
      });
    if (path === "/camera/test") {
      requests.push({ path, body });
      return reply({ ok: !failTest, message: failTest ? "Camera unreachable" : "Verified" });
    }
    if (path === "/camera/start") {
      requests.push({ path, body });
      status = "running";
      return reply({ message: "Started" });
    }
    if (/^\/camera\/\d+\/stop$/.test(path)) {
      requests.push({ path, body });
      status = "stopped";
      return reply({ message: "Stopped" });
    }
    if (path.endsWith("/counting-config")) {
      requests.push({ path, body });
      return reply({ persisted: true, worker_applied: true });
    }
    if (path === "/reports/local" || path === "/reports/submissions") return reply([]);
    if (path === "/metrics/establishment/live")
      return reply({ enterprise_id: user.enterpriseId, occupancy: 1, state: "estimated", contributions: [], missing_camera_ids: [], excluded_camera_ids: [] });
    if (path === "/metrics/establishment/summary")
      return reply({ enterprise_id: user.enterpriseId, days: [], entries: 0, exits: 0, unique_count: 0, peak_occupancy: 0, days_available: 0, days_requested: 1 });
    return reply({});
  });
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(user.email);
  await page.getByPlaceholder("Enter your password").fill("Camera UI test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/enterprise\/dashboard/);
  await page.goto("/#/enterprise/cameras");
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  await expect(page.locator(".camera-preview-state")).toHaveClass(/is-hidden/);
  return {
    profiles: () => profiles,
    requests,
    setStatus: (next: string) => {
      status = next;
    },
    setFailTest: (value: boolean) => {
      failTest = value;
    },
    setFailWrite: (value: boolean) => {
      failWrite = value;
    },
  };
}
const settings = (page: Page) => page.getByRole("region", { name: "Camera Settings", exact: true });
async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await expect(settings(page)).toBeVisible();
}

test("all settings tabs keep drafts, test real bridge requests and save only the selected camera", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1209 });
  await openSettings(page);
  await expect(settings(page).getByRole("tab")).toHaveCount(5);
  await page.screenshot({ path: info.outputPath("camera-information.png"), fullPage: true });
  await page.getByRole("textbox", { name: "Camera Name", exact: true }).fill("Updated Tapo");
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page.getByLabel("Camera Username", { exact: true }).fill("draft-user");
  await page.getByLabel("Camera Password", { exact: true }).fill("draft-secret");
  await page.getByRole("button", { name: "Test Camera Connection", exact: true }).click();
  await expect(page.getByText("Camera connection verified with these settings.", { exact: false })).toBeVisible();
  expect(state.requests.find((value) => value.path === "/camera/test")!.body).toMatchObject({ camera_id: 1, username: "draft-user", password: "draft-secret" });
  expect(state.profiles()[0].name).toBe("Tapo Camera");
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await page.getByRole("switch", { name: "Show Detected People", exact: true }).click();
  await page.getByRole("tab", { name: "Information", exact: true }).click();
  await expect(page.getByLabel("Camera Name", { exact: true })).toHaveValue("Updated Tapo");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0]).toMatchObject({ name: "Updated Tapo" });
  expect(state.profiles()[0]).not.toHaveProperty("autoReconnect");
  expect(state.profiles()[1].name).toBe("Dahua Camera");
  expect(state.profiles()[0]).not.toHaveProperty("password");
  await openSettings(page);
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Show Detected People", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: /Dahua Camera.*Zone:/ }).click();
  await openSettings(page);
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Show Detected People", exact: true })).toBeChecked();
});

test("area dragging, Undo, validation, cancel and resize preserve the saved polygon", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1209 });
  await openSettings(page);
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Counting Area", exact: true });
  const svg = dialog.getByRole("img", { name: "Monitored area polygon" });
  await expect(svg).toBeVisible();
  const point = svg.getByRole("button", { name: "Zone vertex 1" });
  const bounds = (await svg.boundingBox())!;
  await point.hover();
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.3, { steps: 10 });
  await page.mouse.up();
  await expect(point).toHaveAttribute("cx", "25");
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(point).toHaveAttribute("cx", "15");
  await point.focus();
  await point.press("ArrowRight");
  await dialog.getByRole("button", { name: "Use this Area", exact: true }).click();
  expect(state.profiles()[0].openSpace!.polygon[0].x).toBe(0.15);
  await page.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
  await expect(point).toHaveAttribute("cx", "15.5");
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(point).toHaveAttribute("cx", "15.5");
  await page.screenshot({ path: info.outputPath("counting-area-1024.png"), fullPage: true });
  await point.hover();
  await page.mouse.down();
  const resized = (await svg.boundingBox())!;
  await page.mouse.move(resized.x + resized.width * 0.5, resized.y + resized.height * 0.95, { steps: 10 });
  await page.mouse.up();
  await expect(dialog.getByRole("button", { name: "Use this Area", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close Edit Counting Area", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard Changes", exact: true }).click();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0].openSpace!.polygon[0].x).toBe(0.155);
  expect(state.profiles()[1].openSpace!.polygon[0].x).toBe(0.15);
});

test("dropdowns and unsaved dialogs dismiss predictably, and maintenance uses real responses", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSettings(page);
  await page.getByRole("combobox", { name: "Camera brand / type" }).click();
  await page.getByRole("combobox", { name: "Camera Mode" }).click();
  await expect(page.getByRole("listbox")).toHaveCount(1);
  await expect(page.getByRole("listbox", { name: "Camera Mode" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
  await page.getByLabel("Camera Name", { exact: true }).fill("Draft");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Keep Editing" }).click();
  await page.getByRole("tab", { name: "Maintenance", exact: true }).click();
  await page.getByRole("button", { name: "Run Diagnostics", exact: true }).click();
  await expect(page.getByRole("list", { name: "Camera diagnostics" })).toContainText("Raw frame age: 50 ms");
  await page.getByRole("button", { name: "Restore Camera Defaults", exact: true }).click();
  await page.getByRole("dialog", { name: "Restore Camera Defaults", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.profiles()[0].openSpace).not.toBeNull();
  await page.screenshot({ path: info.outputPath("camera-maintenance.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove Camera", exact: true }).click();
  const remove = page.getByRole("dialog", { name: "Remove Camera", exact: true });
  await remove.getByRole("button", { name: "Keep Camera", exact: true }).click();
  expect(state.profiles()).toHaveLength(2);
  await page.getByRole("button", { name: "Reconnect Camera", exact: true }).click();
  await expect.poll(() => state.requests.filter((request) => request.path === "/camera/start").length).toBe(1);
  await page.getByRole("button", { name: "Remove Camera", exact: true }).click();
  await remove.getByRole("button", { name: "Remove Camera", exact: true }).click();
  await expect.poll(() => state.profiles().length).toBe(1);
  expect(state.profiles()[0].id).toBe(2);
});

test("Add Camera keeps the reference form and verifies connection before persisting", async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Camera Information", exact: true });
  await modal.getByRole("button", { name: "Add Camera", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Camera name");
  await modal.getByLabel("Camera Name", { exact: false }).fill("Gate Camera");
  await modal.getByRole("combobox", { name: "Camera Mode" }).click();
  await page.getByRole("option", { name: "Open Space", exact: true }).click();
  await page.screenshot({ path: info.outputPath("add-camera-information.png"), fullPage: true });
  await modal.getByRole("button", { name: "Add Camera", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "Camera Connection", exact: true });
  await connection.getByLabel("Camera IP Address").fill("192.168.1.11");
  await expect(connection.getByText("A camera with this IP address is already configured", { exact: false })).toBeVisible();
  await expect(connection.getByRole("button", { name: "Test & Add Camera" })).toBeDisabled();
  await connection.getByLabel("Camera IP Address").fill("192.168.1.30");
  await connection.getByLabel("Camera Username", { exact: false }).fill("operator");
  await connection.getByLabel("Camera Password", { exact: false }).fill("camera-secret");
  state.setFailTest(true);
  await connection.getByRole("button", { name: "Test & Add Camera" }).click();
  await expect(connection.getByText("Camera unreachable")).toBeVisible();
  expect(state.profiles()).toHaveLength(2);
  state.setFailTest(false);
  state.setFailWrite(true);
  await connection.getByRole("button", { name: "Test & Add Camera" }).click();
  await expect(connection.getByText("Camera storage unavailable")).toBeVisible();
  expect(state.profiles()).toHaveLength(2);
  state.setFailWrite(false);
  await connection.getByRole("button", { name: "Test & Add Camera" }).click();
  await expect(connection).toHaveCount(0);
  await expect.poll(() => state.profiles().length).toBe(3);
  expect(state.profiles()[2]).toMatchObject({ name: "Gate Camera", zone: "", analysisMode: "open_space" });
  expect(JSON.stringify(state.profiles())).not.toContain("camera-secret");
});

test("preview status transitions mask service placeholders and recover without fabricated counts", async ({ page }, info) => {
  const state = await setup(page);
  const overlay = page.locator(".camera-preview-state");
  await expect(overlay).toHaveClass(/is-hidden/);
  for (const [status, label] of [
    ["starting", "Preparing your camera"],
    ["reconnecting", "Restoring connection"],
    ["failed", "Camera needs attention"],
    ["stopped", "Camera preview is paused"],
  ]) {
    state.setStatus(status);
    await expect(overlay.getByRole("heading", { name: label })).toBeVisible({ timeout: 12000 });
    await expect(overlay).not.toHaveClass(/is-hidden/);
  }
  await page.screenshot({ path: info.outputPath("camera-offline.png"), fullPage: true });
  await page.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(overlay).toHaveClass(/is-hidden/, { timeout: 12000 });
  await expect(page.getByText("People in Area: 1", { exact: true })).toBeVisible();
});

test("switching counting methods preserves calibration and stages counting until Save", async ({ page }) => {
  const state = await setup(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("radio", { name: /Entry \/ Exit/ }).check();
  await page.getByRole("radio", { name: /Open Space/ }).check();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0].openSpace!.polygon).toEqual(polygon);
  expect(state.requests.filter((value) => value.path === "/camera/start")).toHaveLength(0);
  await openSettings(page);
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("radio", { name: /Entry \/ Exit/ }).check();
  await page.getByRole("switch", { name: "Enable Visitor Counting", exact: true }).click();
  expect(state.requests.filter((value) => value.path.endsWith("/stop"))).toHaveLength(0);
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  expect(state.profiles()[0].analysisMode).toBe("entrance_exit");
  expect(state.profiles()[1].analysisMode).toBe("open_space");
  expect(state.requests.find((value) => value.path.endsWith("/stop"))!.path).toBe("/camera/1/stop");
});

test("unsaved navigation can be cancelled without retaining a stale navigation action", async ({ page }) => {
  const state = await setup(page);
  await openSettings(page);
  await page.getByLabel("Camera Name", { exact: true }).fill("Unsaved camera");
  await page.locator('[data-topbar-navigation="dashboard"]').click();
  const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(/enterprise\/cameras/);
  await confirm.getByRole("button", { name: "Keep Editing" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirm.getByRole("button", { name: "Discard Changes" }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/enterprise\/cameras/);
  expect(state.profiles()[0].name).toBe("Tapo Camera");
  await openSettings(page);
  await page.getByLabel("Camera Name", { exact: true }).fill("Another draft");
  await page.locator('[data-topbar-navigation="reports"]').click();
  await confirm.getByRole("button", { name: "Discard Changes" }).click();
  await expect(page).toHaveURL(/enterprise\/reports/);
  expect(state.profiles()[0].name).toBe("Tapo Camera");
});
