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
  let presence = 1;
  let streamGeneration = 1;
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
  await page.route(/\/camera-test-frame\.svg(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#486456"/><path d="M0 300L180 90 640 280V360H0Z" fill="#708579"/><rect x="280" y="70" width="80" height="120" rx="10" fill="#c9d6cc"/></svg>',
    }),
  );
  await page.addInitScript(() => {
    const previewUrl = (value: string) => value.startsWith("tanaw-ml://") ? new URL(`/camera-test-frame.svg${new URL(value).search}`, location.origin).href : value;
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...source,
      set(value: string) {
        source.set!.call(this, previewUrl(value));
      },
    });
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return original.call(this, name, this instanceof HTMLImageElement && name === "src" ? previewUrl(value) : value);
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
      stream_generation: streamGeneration,
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
          area: {
            available: status === "running",
            presence: status === "running" ? presence : null,
            unique_visitors_available: status !== "failed",
            unique_visitors: status === "failed" ? null : 8,
            active_visits: [{ track_generation: 5 }],
            zone_name: value.openSpace?.zone_name,
          },
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
    setPresence: (next: number) => {
      presence = next;
    },
    advanceStream: () => ++streamGeneration,
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

test("Camera Settings keeps its actions visible while the active tab scrolls", async ({ page }) => {
  await setup(page);
  await openSettings(page);
  const cameraSettings = settings(page);
  const cancel = cameraSettings.getByRole("button", { name: "Cancel", exact: true });
  const save = cameraSettings.getByRole("button", { name: "Save Changes", exact: true });
  const panel = cameraSettings.getByRole("tabpanel");

  await expect(page.getByRole("region", { name: "My Cameras" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toHaveCount(0);
  await expect(cameraSettings.getByRole("heading", { name: "Tapo Camera" })).toBeVisible();

  for (const size of [{ width: 1920, height: 960 }, { width: 800, height: 500 }, { width: 640, height: 400 }]) {
    await page.setViewportSize(size);
    const tabs = [
      ["Information", panel.getByRole("combobox", { name: "Camera Mode" })],
      ["Connection", panel.getByRole("button", { name: "Test Camera Connection" })],
      ["Counting Area", panel.getByRole("button", { name: "Edit Counting Area" })],
      ["Display", panel.getByRole("switch", { name: "Show Counting Area" })],
      ["Maintenance", panel.getByRole("button", { name: "Remove Camera" })],
    ] as const;
    for (const [name, lastControl] of tabs) {
      await cameraSettings.getByRole("tab", { name, exact: true }).click();
      await expect(cameraSettings).toBeInViewport({ ratio: 1 });
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await expect(save).toBeInViewport({ ratio: 1 });
      await panel.press("End");
      const scrollContainer = size.height <= 450 ? cameraSettings : panel;
      await expect.poll(() => scrollContainer.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
      if (name === "Maintenance" && size.height <= 500) {
        await expect.poll(() => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }
      await lastControl.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await expect(lastControl).toBeInViewport({ ratio: 1 });
      await expect.poll(async () => {
        const control = (await lastControl.boundingBox())!;
        const action = (await cancel.boundingBox())!;
        return control.y + control.height <= action.y;
      }).toBe(true);
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await expect(save).toBeInViewport({ ratio: 1 });
    }
  }

  await cancel.click();
  await expect(cameraSettings).toHaveCount(0);
  await expect(page.getByRole("region", { name: "My Cameras" }).getByRole("button", { name: /Tapo Camera/, pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
});

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
  await page.getByRole("region", { name: "My Cameras" }).getByRole("button", { name: /Dahua Camera/ }).click();
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
  const svg = dialog.getByRole("group", { name: "Monitored area polygon" });
  await expect(svg).toBeVisible();
  const point = svg.getByRole("button", { name: "Zone vertex 1" });
  const bounds = (await svg.boundingBox())!;
  await point.hover();
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.3, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => Number(await point.getAttribute("cx"))).toBeCloseTo(25, 0);
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
  await expect(dialog.getByRole("button", { name: "Use this Area", exact: true })).toBeEnabled();
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
  const ip = connection.getByLabel("Camera IP Address");
  const defaultDark = await page.locator("html").evaluate((element) => element.classList.contains("dark"));
  for (const dark of [false, true]) {
    await page.locator("html").evaluate((element, dark) => element.classList.toggle("dark", dark), dark);
    await page.keyboard.press("Tab");
    for (const label of ["Camera IP Address", "Camera Username", "Camera Password"]) {
      const field = connection.getByLabel(label, { exact: false }).first();
      await field.focus();
      await expect(field).toHaveCSS("outline-width", "2px");
      await expect(field).toHaveCSS("outline-style", "solid");
      await expect(field).toHaveCSS("outline-offset", "-2px");
    }
  }
  await page.locator("html").evaluate((element, dark) => element.classList.toggle("dark", dark), defaultDark);
  await ip.fill("192.168.1.11");
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

test("Add Camera text and actions fit in a compact window in both themes", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 800, height: 500 });
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Camera Information" });
  const input = modal.getByLabel("Camera Name");
  const mode = modal.getByRole("combobox", { name: "Camera Mode" });
  const label = modal.locator("label[for='camera-name']");
  const hint = modal.getByText("Example: Main Gate, Lobby, or Park");
  for (const dark of [false, true]) {
    await page.locator("html").evaluate((element, dark) => element.classList.toggle("dark", dark), dark);
    await expect(label).toHaveCSS("font-size", "15px");
    await expect(input).toHaveCSS("font-size", "16px");
    await expect(mode).toHaveCSS("font-size", "16px");
    await expect(hint).toHaveCSS("font-size", "14px");
    await mode.click();
    await expect(page.getByRole("option", { name: "Open Space", exact: true })).toHaveCSS("font-size", "16px");
    await mode.press("Escape");
    await expect(modal.getByRole("button", { name: "Cancel" })).toBeInViewport({ ratio: 1 });
    await expect(modal.getByRole("button", { name: "Add Camera" })).toBeInViewport({ ratio: 1 });
  }
  await input.fill("Gate Camera");
  await modal.getByRole("button", { name: "Add Camera" }).click();
  const connection = page.getByRole("dialog", { name: "Camera Connection" });
  await expect(connection.getByLabel("Camera IP Address")).toHaveCSS("font-size", "16px");
  await expect(connection.getByRole("button", { name: "Test & Add Camera" })).toBeInViewport({ ratio: 1 });
});

test("camera startup and reconnect do not attach a stream until the service reports real video", async ({ page }, info) => {
  const state = await setup(page);
  const overlay = page.locator(".camera-preview-state");
  const video = page.locator('img[alt$="live camera stream"]');
  await expect(overlay).toHaveClass(/is-hidden/);
  await expect(video).toBeVisible();
  for (const [status, label] of [
    ["starting", "Preparing your camera"],
    ["reconnecting", "Restoring connection"],
    ["failed", "Camera needs attention"],
    ["stopped", "Camera preview is paused"],
  ]) {
    state.setStatus(status);
    await expect(overlay.getByRole("heading", { name: label })).toBeVisible({ timeout: 12000 });
    await expect(overlay).not.toHaveClass(/is-hidden/);
    await expect(video).toHaveCount(0);
    if (status === "starting" || status === "reconnecting") await expect(overlay.getByLabel("Connecting")).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath("camera-offline.png"), fullPage: true });
  await page.getByRole("button", { name: "Start Camera", exact: true }).click();
  await expect(overlay).toHaveClass(/is-hidden/, { timeout: 12000 });
  await expect(video).toBeVisible();
  await expect(page.locator(".tanaw-toast--success").filter({ hasText: "Camera counting started." })).toHaveCount(1);
  const preview = page.getByRole("region", { name: "Camera Preview", exact: true });
  await expect(preview.getByText(/^● Live$|^People in area:|^Model (ready|loading|standby)$|AI FPS/)).toHaveCount(0);
  await expect(preview.getByRole("img", { name: "Monitored area polygon" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Live Metrics" }).getByText("1", { exact: true })).toBeVisible();

  let releaseFrame!: () => void;
  const firstFrame = new Promise<void>((resolve) => { releaseFrame = resolve; });
  await page.route(/\/camera-test-frame\.svg\?.*generation=2(?:&|$)/, async (route) => {
    await firstFrame;
    await route.fallback();
  });
  try {
    state.advanceStream();
    await expect(video).toHaveAttribute("src", /overlay=0.*generation=2/);
    await expect(video).toBeHidden();
    await expect(overlay.getByRole("heading", { name: "Connecting to camera" })).toBeVisible();
  } finally {
    releaseFrame();
  }
  await expect(video).toBeVisible();
});

test("uses the preview toolbar and keeps the selected stream aligned while resizing", async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 940 });
  const state = await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const selected = page.getByRole("region", { name: "Selected camera" });
  const toolbar = page.getByRole("group", { name: "Camera preview controls" });
  const preview = page.getByRole("region", { name: "Camera Preview" });
  const video = preview.getByRole("img", { name: "Tapo Camera live camera stream" });
  const metrics = page.getByRole("region", { name: "Live Metrics" });
  const overlay = preview.getByRole("img", { name: "Monitored area polygon" });
  const originalProfile = state.profiles()[0];

  await expect(selected.getByRole("heading", { name: "Tapo Camera", exact: true })).toBeVisible();
  await expect(metrics.getByText("8", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /monitoring status|system status|camera connection/i })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Start Camera" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Stop Camera" })).toBeVisible();
  await video.evaluate((element) => element.setAttribute("data-test-original-frame", "true"));
  const assertAligned = async () => {
    await expect.poll(async () => {
      const image = await video.boundingBox();
      const polygonBox = await overlay.boundingBox();
      if (!image || !polygonBox) return Number.POSITIVE_INFINITY;
      const fittedWidth = Math.min(image.width, image.height * 16 / 9);
      const fittedHeight = Math.min(image.height, image.width * 9 / 16);
      return Math.max(
        Math.abs(polygonBox.width - fittedWidth),
        Math.abs(polygonBox.height - fittedHeight),
        Math.abs(polygonBox.x - (image.x + (image.width - fittedWidth) / 2)),
        Math.abs(polygonBox.y - (image.y + (image.height - fittedHeight) / 2)),
      );
    }).toBeLessThan(2);
  };
  const assertToolbarEdge = async () => {
    await expect.poll(() => preview.evaluate((element) => {
      const stage = element.querySelector(".camera-video-preview")!.getBoundingClientRect();
      const actions = element.querySelector(".camera-preview-actions")!.getBoundingClientRect();
      return Math.abs(stage.right - actions.right);
    })).toBeLessThan(2);
  };
  const assertWidePanelLayout = async () => {
    await expect.poll(() => selected.evaluate((element) => {
      const layout = element.querySelector(".camera-preview-layout")!;
      const previewBox = layout.querySelector(".camera-preview-surface")!.getBoundingClientRect();
      const metricsBox = layout.querySelector(".camera-live-metrics")!.getBoundingClientRect();
      return Math.max(
        Math.abs(previewBox.top - metricsBox.top),
        Math.abs(previewBox.bottom - metricsBox.bottom),
        layout.scrollWidth - layout.clientWidth,
        layout.scrollHeight - layout.clientHeight,
      );
    })).toBeLessThan(2);
  };
  await assertAligned();
  await assertToolbarEdge();
  await assertWidePanelLayout();
  await page.screenshot({ path: info.outputPath("monitor-expanded.png") });
  const width = (await preview.boundingBox())!.width;
  const collapse = page.getByRole("button", { name: "Collapse configured cameras" });
  await collapse.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Collapse configured cameras");
  await collapse.click();
  await expect(page.getByRole("img", { name: "2 configured cameras" })).toBeVisible();
  await expect.poll(async () => (await preview.boundingBox())!.width).toBeGreaterThan(width + 100);
  const sidebar = page.getByRole("region", { name: "My Cameras" });
  await expect(sidebar.getByRole("button", { name: /Dahua Camera/, pressed: false })).toBeVisible();
  await expect.poll(async () => (await sidebar.boundingBox())!.height).toBeLessThan(290);
  await expect(video).toHaveAttribute("data-test-original-frame", "true");
  await assertAligned();
  await assertToolbarEdge();
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
  await page.screenshot({ path: info.outputPath("monitor-compact.png") });
  await page.getByRole("button", { name: "Expand configured cameras" }).click();
  await expect(page.getByRole("button", { name: /Tapo Camera/, pressed: true })).toBeVisible();

  await toolbar.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("camera-preview-surface"))).toBe(true);
  const ambience = metrics.locator(".camera-metrics-ambience");
  await expect(ambience).not.toHaveAttribute("data-ambient-active");
  await expect(video).toHaveAttribute("data-test-original-frame", "true");
  await assertAligned();
  await assertToolbarEdge();
  await toolbar.getByRole("button", { name: "Exit Fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(ambience).toHaveAttribute("data-ambient-active", "");

  await toolbar.getByRole("button", { name: "Refresh Preview", exact: true }).click();
  await expect(video).toHaveAttribute("src", /[?&]refresh=1(?:&|$)/);
  await expect(video).toBeVisible();
  expect(state.requests).toEqual([]);
  expect(state.profiles()[0]).toEqual(originalProfile);

  await toolbar.getByRole("button", { name: "Stop Camera", exact: true }).click();
  await expect(video).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Refresh Preview", exact: true })).toHaveCount(0);
  await expect(metrics.getByText("Live observations unavailable")).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Camera preview is paused" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Collapse configured cameras" }).click();
  await assertToolbarEdge();
  await assertWidePanelLayout();
  await page.screenshot({ path: info.outputPath("monitor-stopped.png") });
  await toolbar.getByRole("button", { name: "Start Camera", exact: true }).click();
  await expect(video).toBeVisible();
  expect(state.requests.map(({ path }) => path)).toEqual(["/camera/1/stop", "/camera/start"]);
  expect(state.profiles()[0]).toEqual(originalProfile);

  await sidebar.getByRole("button", { name: "Expand configured cameras" }).click();
  await page.setViewportSize({ width: 800, height: 620 });
  await metrics.scrollIntoViewIfNeeded();
  await expect(metrics).toBeVisible();
  await expect(metrics.locator(".camera-metrics-ambience")).toBeHidden();
  expect((await metrics.boundingBox())!.y).toBeGreaterThan((await preview.boundingBox())!.y);
  await assertAligned();

  await sidebar.getByRole("button", { name: "Collapse configured cameras" }).click();
  await sidebar.getByRole("button", { name: /Dahua Camera/ }).press("Enter");
  await expect(selected.getByRole("heading", { name: "Dahua Camera", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /Dahua Camera/, pressed: true })).toBeFocused();
  state.setStatus("failed");
  await expect(preview.getByRole("heading", { name: "Camera needs attention" })).toBeVisible();
  await expect(preview.getByRole("alert")).toContainText("Camera unreachable");
  await expect(metrics.getByText("Live observations unavailable")).toBeVisible();
  await expect(metrics.getByText("Identification unavailable")).toBeVisible();
  await expect(metrics.getByText("—", { exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 1920, height: 940 });
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
  await assertWidePanelLayout();
  await page.screenshot({ path: info.outputPath("monitor-disconnected.png") });
  await openSettings(page);
  await settings(page).getByRole("tab", { name: "Connection" }).click();
  await expect(settings(page).getByRole("tab", { name: "Connection", selected: true })).toBeVisible();
});

test("Live Metrics aims its lines at the pointer and pauses ambient motion when hidden", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const metrics = page.getByRole("region", { name: "Live Metrics" });
  const ambience = metrics.locator(".camera-metrics-ambience");
  const lines = ambience.locator("canvas.camera-metrics-lines");
  await expect(ambience).toHaveAttribute("data-ambience-tone", "calm");
  await expect(ambience).toHaveAttribute("data-ambient-active", "");
  await expect(ambience).toHaveCSS("mask-image", /^linear-gradient/);
  const picture = () => lines.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  const rest = await picture();
  const palette = () => ambience.evaluate((element) =>
    ["::before", "::after"].map((layer) => {
      const style = getComputedStyle(element, layer);
      return [style.backgroundColor, style.opacity];
    }),
  );
  const drift = () => ambience.evaluate((element) => getComputedStyle(element, "::before").transform);
  const calmPalette = await palette();
  const initialDrift = await drift();
  await expect.poll(drift).not.toBe(initialDrift);
  const hoverAt = async (x: number) => {
    const bounds = (await ambience.boundingBox())!;
    await ambience.hover({ position: { x: bounds.width * x, y: bounds.height * 0.65 } });
  };
  await hoverAt(0.8);
  await expect.poll(picture).not.toBe(rest);
  const right = await picture();
  expect(await palette()).toEqual(calmPalette);
  await hoverAt(0.2);
  await expect.poll(picture).not.toBe(right);
  await expect.poll(picture).not.toBe(rest);
  await page.getByRole("heading", { name: "Live Metrics", exact: true }).hover();
  await expect.poll(picture).toBe(rest);

  state.setPresence(7);
  await expect(metrics.getByText("7", { exact: true })).toBeVisible();
  await expect(ambience).toHaveAttribute("data-ambience-tone", "moderate");
  await expect.poll(palette).not.toEqual(calmPalette);
  await page.screenshot({ path: info.outputPath("metrics-lines-light.png") });

  await page.setViewportSize({ width: 800, height: 620 });
  await expect(ambience).toBeHidden();
  await expect(ambience).not.toHaveAttribute("data-ambient-active");
  await expect.poll(() => ambience.evaluate((element) => getComputedStyle(element, "::before").animationPlayState)).toBe("paused");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(ambience).toHaveAttribute("data-ambient-active", "");

  state.setPresence(18);
  await expect(metrics.getByText("18", { exact: true })).toBeVisible();
  await expect(ambience).toHaveAttribute("data-ambience-tone", "high");
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition");
  const darkRest = await picture();
  await hoverAt(0.8);
  await expect.poll(picture).not.toBe(darkRest);
  await page.screenshot({ path: info.outputPath("metrics-lines-dark.png") });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(ambience).not.toHaveAttribute("data-ambient-active");
  await expect.poll(picture).toBe(darkRest);
  await hoverAt(0.2);
  await expect.poll(picture).toBe(darkRest);
  await expect.poll(() => ambience.evaluate((element) => getComputedStyle(element, "::before").animationName)).toBe("none");
  await expect.poll(() => ambience.evaluate((element) => getComputedStyle(element, "::after").transitionDuration)).toBe("0s");
  state.setStatus("failed");
  await expect(ambience).toHaveAttribute("data-ambience-tone", "attention");
  await expect(metrics.getByText("Live observations unavailable")).toBeVisible();
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
