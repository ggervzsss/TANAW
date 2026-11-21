// Shared camera workspace for camera-settings.spec.ts and camera-preview.spec.ts: two mocked cameras,
// a fake ML bridge whose status, presence, stream and failures each test controls, and helpers.
import { expect, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./preload";
import type { Camera } from "../../../../src/types/enterprise";

export const polygon = [
  { x: 0.15, y: 0.2 },
  { x: 0.85, y: 0.2 },
  { x: 0.85, y: 0.85 },
  { x: 0.15, y: 0.85 },
];
export const camera = (id: number): Camera => ({
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
export async function setup(page: Page) {
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
    const previewUrl = (value: string) => (value.startsWith("tanaw-ml://") ? new URL(`/camera-test-frame.svg${new URL(value).search}`, location.origin).href : value);
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
export const settings = (page: Page) => page.getByRole("region", { name: "Camera Settings", exact: true });
export async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await expect(settings(page)).toBeVisible();
}
