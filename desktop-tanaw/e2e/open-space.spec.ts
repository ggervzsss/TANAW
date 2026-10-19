import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest } from "./support/preload";
import type { Camera } from "../src/types/enterprise";

const user = { id: "area-operator", email: "area@example.test", role: "enterprise", name: "Park Operator", enterpriseId: "park_001", enterpriseName: "Park" };
const zone = {
  zone_id: "main",
  zone_name: "Seating area",
  polygon: [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ],
};
const config = {
  tripwire: 50,
  tripwires: { entry: { start: { x: 30, y: 10 }, end: { x: 30, y: 90 } }, exit: { start: { x: 70, y: 10 }, end: { x: 70, y: 90 } } },
  roi: { top: 0, left: 0, width: 100, height: 100 },
  reverse: false,
};
const camera: Camera = {
  id: 1,
  name: "Plaza camera",
  zone: "Plaza",
  analysisMode: "open_space",
  openSpace: zone,
  status: "stopped",
  rtsp: "rtsp://192.168.1.9/stream2",
  cameraHost: "192.168.1.9",
  rtspStream: "stream2",
  processingProfile: "auto",
  confidence: 0.35,
  config,
};

async function setup(page: Page, configured = true) {
  let signedIn = false;
  let profiles: Camera[] = [{ ...camera, openSpace: configured ? zone : null }];
  let running = true;
  const starts: unknown[] = [];
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ json: { token: "area-test", user } });
  });
  await page.route("**/auth/session", (route) => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { token: "area-test", user } : { detail: "Sign in" } }));
  await page.route("**/auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ json: [] }));
  await page.route("**/operational/tickets", (route) => route.fulfill({ json: [] }));
  await page.route("**/e2e-camera.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#123"/></svg>' }),
  );
  await page.addInitScript(() => {
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...source,
      set(value: string) {
        source.set!.call(this, value.startsWith("tanaw-ml://") ? new URL("/e2e-camera.svg", window.location.origin).href : value);
      },
    });
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return original.call(this, name, this instanceof HTMLImageElement && name === "src" && value.startsWith("tanaw-ml://") ? new URL("/e2e-camera.svg", window.location.origin).href : value);
    };
    window.tanawCameraCredentials = {
      load: async () => ({ "1": { username: "camera", passwordConfigured: true } }),
      save: async () => ({ username: "camera", passwordConfigured: true }),
      remove: async () => {},
      request: async (id, operation, payload) => {
        if (operation === "test") return { ok: true, message: "Verified" };
        return window.tanawMlService!.request({ url: `http://127.0.0.1:8765/camera/${operation}`, method: "POST", body: JSON.stringify(payload) }).then((r) => JSON.parse(r.body));
      },
    };
  });
  await mockMlRequest(page, "*", (request) => {
    const path = new URL(request.url).pathname;
    const reply = (value: unknown) => mlResponse({ status: 200, body: JSON.stringify(value) });
    if (path === "/context/enterprise") return reply({ enterprise_id: user.enterpriseId, enterprise_name: "Park", changed: true, session_restored: false });
    if (path === "/cameras") {
      if (request.method === "PUT") profiles = JSON.parse(request.body ?? "{}").cameras;
      return reply(profiles);
    }
    if (path === "/camera/start") {
      starts.push(JSON.parse(request.body ?? "{}"));
      running = true;
      return reply({ accepted: true, message: "Started" });
    }
    if (path.endsWith("/stop")) {
      running = false;
      return reply({ stopped: true });
    }
    const health = {
      status: "ok",
      running,
      api_contract_version: 2,
      tripwire_hot_update: true,
      max_configured_cameras: 6,
      max_concurrent_cameras: 6,
      model_ready: true,
      raw_frame_stale_ms: 0,
      processed_frame_stale_ms: 0,
      stream_frame_stale_ms: 0,
      active_camera_count: running ? 1 : 0,
    };
    if (path === "/health") return reply(health);
    if (path === "/cameras/runtime")
      return reply({
        enterprise_id: user.enterpriseId,
        enterprise_occupancy: 0,
        active_camera_count: running ? 1 : 0,
        max_configured_cameras: 6,
        max_concurrent_cameras: 6,
        pending_camera_ids: [],
        cameras: [
          {
            enterprise_id: user.enterpriseId,
            camera_id: 1,
            analysis_mode: "open_space",
            counts: { running, status: running ? "running" : "stopped", error: null, entry: null, exit: null, occupancy: null },
            detections: { running, status: "running", frame_width: 640, frame_height: 360, tracks: [] },
            health,
            session: { running, status: "running", counts: { running } },
            area: {
              available: configured,
              presence: configured ? 3 : null,
              temporarily_missing: 1,
              active_visits: [],
              zone_name: "Seating area",
              revision_id: "r1",
              last_observed_at: new Date().toISOString(),
            },
          },
        ],
      });
    if (path === "/metrics/open-space/summary")
      return reply({
        camera_id: 1,
        revision_id: "r1",
        revisions: [{ revision_id: "r1", zone_name: "Seating area", created_at: new Date().toISOString() }],
        observed_visits: 8,
        completed_count: 5,
        incomplete_count: 3,
        active_count: 0,
        average_dwell_ms: 125000,
        median_dwell_ms: 120000,
        p90_dwell_ms: 180000,
        duration_buckets: [1, 4, 0, 0, 0],
        covered_ms: 1000,
        coverage_ratio: 0.75,
        peak_presence: 5,
        history: [{ at: new Date().toISOString(), peak_presence: 3, covered_ms: 10000, completed_count: 5, arrivals: 8 }],
        visits: [],
        total_records: 0,
      });
    if (path === "/reports/submissions") return reply([]);
    if (path === "/metrics/summary") return reply({ entries: 0, exits: 0, current_occupancy: 0, peak_occupancy: 0, unique_count: 0, total_events: 0, unsubmitted_events: 0, unsynced_events: 0 });
    if (path === "/metrics/history") return reply({ hourly_density: [], historical: { Today: [], Week: [], Month: [] } });
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Fixture operation not configured" }) });
  });
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(user.email);
  await page.getByPlaceholder("Enter your password").fill("Park operator password 2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/enterprise\/dashboard/);
  return { starts, profiles: () => profiles };
}

test("loads open-space analytics directly after login and keeps doorway reports separate", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "Open Space Activity" })).toBeVisible();
  await expect(page.getByText("75.0%", { exact: true })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Hourly observed presence and arrivals" }).locator("svg").first()).toBeVisible();
  await expect(page.getByText("2m 0s", { exact: true })).toBeVisible();
  await expect(page.getByText("Dwell statistics use 5 completed visits", { exact: false })).toBeVisible();
  await page.goto("/#/enterprise/reports");
  await expect(page.getByText("Establishment reports require Entrance / Exit measurements", { exact: false })).toBeVisible();
});

test("draws and saves a zone against a decoded preview before starting dwell analysis", async ({ page }) => {
  const state = await setup(page, false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/enterprise/cameras");
  await expect(page.getByText("Zone setup required.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await expect(page.getByRole("textbox", { name: "Username", exact: true })).toHaveValue("camera");
  const svg = page.getByRole("img", { name: "Monitored area polygon" });
  await expect.poll(async () => await svg.locator("..").locator("button", { hasText: "Clear zone" }).count()).toBe(1);
  const bounds = await svg.boundingBox();
  expect(bounds).not.toBeNull();
  for (const [x, y] of [
    [0.2, 0.3],
    [0.8, 0.3],
    [0.8, 0.7],
    [0.2, 0.7],
  ])
    await page.mouse.click(bounds!.x + bounds!.width * x, bounds!.y + bounds!.height * y);
  await page.getByRole("textbox", { name: "Monitored Area Name" }).fill("Plaza seating");
  await page.getByRole("button", { name: "Save Config", exact: true }).click();
  await expect.poll(() => state.profiles()[0].openSpace?.polygon.length).toBe(4);
  expect(state.profiles()[0].openSpace?.polygon[0].x).toBeCloseTo(0.2, 2);
  expect(state.profiles()[0].openSpace?.polygon[0].y).toBeCloseTo(0.3, 2);
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0]).toMatchObject({ analysis_mode: "open_space", preview_only: false, open_space: { zone_name: "Plaza seating" } });
});
