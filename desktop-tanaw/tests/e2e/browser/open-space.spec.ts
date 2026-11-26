import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockMlRequest, switchTheme } from "./support/preload";
import type { Camera } from "../../../src/types/enterprise";

test.describe.configure({ timeout: 60_000 });

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
  processingProfile: "auto",
  confidence: 0.35,
  config,
};

async function setup(page: Page, configured = true, mixed = false, frame = { width: 640, height: 360 }) {
  let signedIn = false;
  let profiles: Camera[] = [{ ...camera, analysisMode: "open_space", openSpace: configured ? zone : null }];
  if (mixed) {
    profiles.push({ ...camera, id: 2, name: "Entrance camera", analysisMode: "entrance_exit", openSpace: null });
  }
  let running = true;
  let presence: number | null = 3;
  const starts: unknown[] = [];
  let liveRequests = 0;
  await page.route("**/auth/login", (route) => {
    signedIn = true;
    return route.fulfill({ json: { token: "area-test", user } });
  });
  await page.route("**/auth/session", (route) => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { token: "area-test", user } : { detail: "Sign in" } }));
  await page.route("**/auth/me", (route) => route.fulfill({ json: user }));
  await page.route("**/operational/notifications", (route) => route.fulfill({ json: [] }));
  await page.route("**/operational/requests", (route) => route.fulfill({ json: [] }));
  await page.route("**/e2e-camera.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}"><rect width="100%" height="100%" fill="#123"/></svg>` }),
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
      request: async (_id, operation, payload) => {
        if (operation === "test") return { ok: true, message: "Verified" };
        return window.tanawMlService!.request({ url: `http://127.0.0.1:8765/camera/${operation}`, method: "POST", timeoutMs: 1000, body: JSON.stringify(payload) }).then((r) => JSON.parse(r.body));
      },
    };
  });
  await mockMlRequest(page, "*", (request) => {
    const path = new URL(request.url).pathname;
    const reply = (value: unknown) => mlResponse({ status: 200, body: JSON.stringify(value) });
    if (path === "/metrics/establishment/live") {
      liveRequests += 1;
      const occupancy = mixed ? 12 : configured ? presence : null;
      return reply({
        enterprise_id: user.enterpriseId,
        occupancy,
        partial_occupancy: occupancy ?? 0,
        state: occupancy === null ? "unavailable" : "estimated",
        contributions:
          occupancy === null
            ? []
            : mixed
              ? [
                  { camera_ids: [2], occupancy: 9, state: "estimated", basis: "entry_exit_balance" },
                  { camera_ids: [1], occupancy: 3, state: "estimated", basis: "observed_presence" },
                ]
              : [{ camera_ids: [1], occupancy, state: "estimated", basis: "observed_presence" }],
        missing_camera_ids: occupancy === null ? [1] : [],
        movement_available: mixed,
        identification_available: configured,
      });
    }
    if (path === "/metrics/establishment/summary") {
      const query = new URL(request.url).searchParams;
      const first = query.get("start") ?? new Date().toISOString();
      const stop = query.get("end") ?? new Date().toISOString();
      const days = Math.max(1, Math.round((Date.parse(stop) - Date.parse(first)) / 86400000));
      const values = {
        unique_count: mixed ? 20 : 7,
        confirmed_unique_count: mixed ? 20 : 7,
        entries: mixed ? 20 : 0,
        exits: mixed ? 8 : 0,
        repeat_entry_count: 0,
        unresolved_observations: 0,
        qualified_observations: mixed ? 27 : 7,
        identification_state: "available",
        reconciliation_state: configured ? "estimated" : "not_collected",
        movement_state: mixed ? "available" : "unavailable",
        peak_occupancy: mixed ? 12 : 5,
        covered_ms: 10000,
        coverage_ratio: 10000 / (days * 86400000),
        counting_basis: "sum_of_daily_establishment_unique_visitors",
        policy_version: 1,
      };
      return reply({
        ...values,
        enterprise_id: user.enterpriseId,
        from_at: first,
        to_at: stop,
        timezone: "Asia/Manila",
        snapshot_version: "fixture",
        days_available: 1,
        days_requested: days,
        days: [
          {
            ...values,
            business_date: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
            finalized: false,
            sources: mixed ? [1, 2] : [1],
            identification_coverage: 1,
            first_event_at: first,
            last_event_at: stop,
            incompatible_identity_models: false,
            unconfigured_camera_pairs: [],
          },
        ],
      });
    }
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
            detections: { running, status: "running", frame_width: frame.width, frame_height: frame.height, tracks: [] },
            health,
            session: { running, status: "running", counts: { running } },
            area: {
              available: configured && presence !== null,
              presence: configured ? presence : null,
              temporarily_missing: 1,
              unique_visitors: configured ? 7 : null,
              unique_visitors_available: configured,
              unique_visitors_date: "2026-10-29",
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
    if (path === "/reports/local") return reply([]);
    if (path === "/metrics/summary")
      return reply({
        entries: mixed ? 20 : 0,
        exits: mixed ? 8 : 0,
        current_occupancy: mixed ? 12 : 0,
        peak_occupancy: 12,
        unique_count: mixed ? 20 : 0,
        total_events: 0,
        unsubmitted_events: 0,
        unsynced_events: 0,
      });
    if (path === "/metrics/history") return reply({ hourly_density: [], historical: { Today: [], Week: [], Month: [] } });
    return mlResponse({ status: 503, body: JSON.stringify({ detail: "Fixture operation not configured" }) });
  });
  await page.goto("/#/login");
  await page.getByPlaceholder("Enter username or registered email").fill(user.email);
  await page.getByPlaceholder("Enter your password").fill("Park operator password 2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/enterprise\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 20_000 });
  return {
    starts,
    liveRequests: () => liveRequests,
    profiles: () => profiles,
    setPresence: (value: number | null) => {
      presence = value;
    },
  };
}

test("shows one establishment dashboard for an Open Space-only setup", async ({ page }, testInfo) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open Space Activity" })).toHaveCount(0);
  const header = page.getByRole("region", { name: "Enterprise analytics summary", exact: true });
  await expect(header.locator('[data-metric-segment="occupancy"]').getByText("3", { exact: true })).toBeVisible();
  // Open Space cameras count people inside, not doorway entries.
  await expect(header.locator('[data-metric-segment="entries"]')).toContainText("Unavailable for these cameras");
  await expect(page.getByRole("combobox", { name: "Activity history source", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Visitor Traffic", exact: true })).toBeVisible();
  await expect(page.getByText(/dwell|duration/i)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("shared-occupancy-dashboard.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/enterprise/cameras");
  const metrics = page.locator("section").filter({ has: page.getByRole("heading", { name: "Live Metrics", exact: true }) });
  await expect(metrics.getByText("Live Occupancy", { exact: true }).locator("../..").getByText("3", { exact: true })).toBeVisible();
  await expect(metrics.getByText("Unique Visitors", { exact: true }).locator("../..").getByText("7", { exact: true })).toBeVisible();
  await expect(metrics.getByText("Tracking gaps", { exact: true })).toHaveCount(0);
  await expect(metrics.getByText(/dwell|in monitored area/i)).toHaveCount(0);
  await metrics.screenshot({ path: testInfo.outputPath("open-space-live-metrics.png") });
});

test("adds Entry / Exit and Open Space cameras into one live occupancy without a mode toggle", async ({ page }, testInfo) => {
  const state = await setup(page, true, true);
  const header = page.getByRole("region", { name: "Enterprise analytics summary", exact: true });
  await expect(header.getByText("12", { exact: true }).first()).toBeVisible();
  await expect(header.getByText("Total Entries", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Activity history source", exact: true })).toHaveCount(0);
  await expect(header.locator('[data-metric-segment="entries"]').getByText("20", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("combined-occupancy.png"), fullPage: true });
  state.setPresence(0);
  let previousRequests = state.liveRequests();
  await expect.poll(() => state.liveRequests()).toBeGreaterThan(previousRequests);
  await expect(header.getByText("12", { exact: true }).first()).toBeVisible();
  state.setPresence(null);
  previousRequests = state.liveRequests();
  await expect.poll(() => state.liveRequests()).toBeGreaterThan(previousRequests);
  await expect(header.getByText("12", { exact: true }).first()).toBeVisible();
});

for (const { viewport, frame, theme } of [
  { viewport: { width: 1440, height: 1000 }, frame: { width: 640, height: 360 }, theme: "dark" },
  { viewport: { width: 1024, height: 768 }, frame: { width: 480, height: 640 }, theme: "light" },
] as const) {
  test(`edits and saves a centered zone on a ${frame.width}×${frame.height} feed at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state = await setup(page, false, false, frame);
    await page.setViewportSize(viewport);
    await switchTheme(page, theme);
    await page.goto("/#/enterprise/cameras");
    await expect(page.getByText("Zone setup required.", { exact: false })).toBeVisible();
    await expect(page.getByText("Live observations unavailable", { exact: true })).toBeVisible();
    const metrics = page.locator("section").filter({ has: page.getByRole("heading", { name: "Live Metrics", exact: true }) });
    await expect(metrics.getByText("—", { exact: true })).toHaveCount(2);
    await page.getByRole("button", { name: "Edit configuration" }).click();
    await page.getByRole("tab", { name: "Connection", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Camera Username", exact: true })).toHaveValue("camera");
    await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
    await page.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Counting Area", exact: true });
    const svg = dialog.getByRole("group", { name: "Monitored area polygon" });
    const tools = dialog.getByRole("region", { name: "Monitored area editing tools", exact: true });
    const point = (index: number) => svg.getByRole("button", { name: `Zone vertex ${index}`, exact: true });
    const points = svg.getByRole("button", { name: /Zone vertex/ });
    const undo = dialog.getByRole("button", { name: "Undo", exact: true });
    const remove = tools.getByRole("button", { name: "Delete Point", exact: true });
    const reset = tools.getByRole("button", { name: "Reset box", exact: true });
    const useArea = dialog.getByRole("button", { name: "Use this Area", exact: true });
    const coordinate = async (index: number, axis: "x" | "y") => Number(await point(index).getAttribute(`c${axis}`)) / 100;
    const expectPoint = async (index: number, x: number, y: number) => {
      await expect.poll(() => coordinate(index, "x")).toBeCloseTo(x, 2);
      await expect.poll(() => coordinate(index, "y")).toBeCloseTo(y, 2);
    };
    await expect(points).toHaveCount(4);
    await expectPoint(1, 0.25, 0.25);
    await expectPoint(3, 0.75, 0.75);
    await expect(undo).toBeDisabled();
    await svg.scrollIntoViewIfNeeded();
    const bounds = (await svg.boundingBox())!;
    const image = (await dialog.locator('img[alt$="live camera stream"]').boundingBox())!;
    expect(bounds.width / bounds.height).toBeCloseTo(frame.width / frame.height, 4);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(image.x + image.width / 2, 0);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(image.y + image.height / 2, 0);
    expect((await tools.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);

    const click = async (x: number, y: number) => {
      await svg.scrollIntoViewIfNeeded();
      const rect = (await svg.boundingBox())!;
      await page.mouse.click(rect.x + rect.width * x, rect.y + rect.height * y);
    };
    const drag = async (fromX: number, fromY: number, toX: number, toY: number) => {
      await svg.scrollIntoViewIfNeeded();
      const rect = (await svg.boundingBox())!;
      await page.mouse.move(rect.x + rect.width * fromX, rect.y + rect.height * fromY);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width * toX, rect.y + rect.height * toY, { steps: 8 });
      await page.mouse.up();
    };

    await click(0.1, 0.1);
    await expect(points).toHaveCount(4);
    await drag(0.5, 0.5, 0.6, 0.58);
    await expectPoint(1, 0.35, 0.33);
    await expectPoint(3, 0.85, 0.83);
    await undo.click();
    await expectPoint(1, 0.25, 0.25);

    await drag(0.25, 0.25, -0.03, -0.04);
    await expectPoint(1, 0, 0);
    await expect(point(1)).toHaveAttribute("aria-pressed", "true");
    await drag(0, 0, 0.06, 0.06);
    await expectPoint(1, 0.06, 0.06);
    await expectPoint(2, 0.75, 0.06);
    await drag(0.45, 0.06, 0.45, 0.18);
    await expectPoint(2, 0.75, 0.18);

    await click(0.4, await coordinate(1, "y"));
    await expect(points).toHaveCount(5);
    await expect(point(2)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Delete");
    await expect(points).toHaveCount(4);
    await point(1).focus();
    await remove.click();
    await expect(points).toHaveCount(3);
    await point(1).focus();
    await expect(remove).toBeDisabled();
    await page.keyboard.press("Backspace");
    await expect(points).toHaveCount(3);
    await undo.click();
    await expect(points).toHaveCount(4);

    await tools.getByRole("button", { name: "Clear zone", exact: true }).click();
    await expect(points).toHaveCount(0);
    await expect(useArea).toBeDisabled();
    await click(0.2, 0.2);
    await click(0.8, 0.2);
    await click(0.5, 0.75);
    await expect(points).toHaveCount(3);
    await reset.click();
    await expectPoint(1, 0.25, 0.25);
    await expectPoint(3, 0.75, 0.75);
    await drag(0.75, 0.75, 1.02, 1.04);
    await expectPoint(3, 1, 1);
    await drag(1, 1, 0.88, 0.9);
    await expectPoint(3, 0.88, 0.9);
    await page.setViewportSize({ width: viewport.width - 100, height: viewport.height + 50 });
    await expectPoint(3, 0.88, 0.9);
    await page.screenshot({ path: testInfo.outputPath("zone-tools-outside-preview.png"), fullPage: true });
    await useArea.click();
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect.poll(() => state.profiles()[0].openSpace?.polygon.length).toBe(4);
    expect(state.profiles()[0].openSpace?.polygon[0].x).toBeCloseTo(0.25, 2);
    expect(state.profiles()[0].openSpace?.polygon[0].y).toBeCloseTo(0.25, 2);
    expect(state.profiles()[0].openSpace?.polygon[2].x).toBeCloseTo(0.88, 2);
    expect(state.profiles()[0].openSpace?.polygon[3].y).toBeCloseTo(0.9, 2);
    await expect.poll(() => state.starts.length).toBe(1);
    expect(state.starts[0]).toMatchObject({ analysis_mode: "open_space", preview_only: false, open_space: { zone_id: "main" } });
  });
}

test("camera settings tabs, scoped display saves, cancellation, editor undo and responsive layout", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await setup(page);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await switchTheme(page, "light");
  await page.goto("/#/enterprise/cameras");
  await page.getByRole("button", { name: "Edit configuration" }).click();
  const settings = page.getByRole("region", { name: "Camera Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("tab")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("camera-information.png"), fullPage: true });
  await settings.getByRole("textbox", { name: "Camera Name", exact: true }).fill("");
  await settings.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("Enter a camera name between 2 and 120 characters.");
  await expect(settings.getByRole("textbox", { name: "Camera Name", exact: true })).toBeFocused();
  await settings.getByRole("textbox", { name: "Camera Name", exact: true }).fill("Unsaved name");
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard Changes", exact: true }).click();
  expect(state.profiles()[0].name).toBe("Plaza camera");
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await expect(settings.getByRole("textbox", { name: "Camera Name", exact: true })).toHaveValue("Plaza camera");
  for (const tab of ["Connection", "Counting Area", "Display", "Maintenance"]) {
    await settings.getByRole("tab", { name: tab, exact: true }).click();
    await expect(settings.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: testInfo.outputPath("camera-" + tab.replaceAll(" ", "-") + ".png"), fullPage: true });
  }
  await settings.getByRole("button", { name: "Reconnect Camera", exact: true }).click();
  await expect.poll(() => state.starts.length).toBe(1);
  await expect(settings.getByRole("button", { name: "Run Diagnostics", exact: true })).toBeEnabled();
  await settings.getByRole("button", { name: "Run Diagnostics", exact: true }).click();
  await expect(settings.getByRole("list", { name: "Camera diagnostics" })).toBeVisible();
  await settings.getByRole("button", { name: "Restore Camera Defaults", exact: true }).click();
  const reset = page.getByRole("dialog", { name: "Restore Camera Defaults", exact: true });
  await expect(reset).toBeVisible();
  await reset.getByRole("button", { name: "Cancel", exact: true }).click();
  await settings.getByRole("tab", { name: "Display", exact: true }).click();
  const people = settings.getByRole("switch", { name: "Show Detected People" });
  await people.click();
  await expect(people).toHaveAttribute("aria-checked", "false");
  await settings.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await settings.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(people).toHaveAttribute("aria-checked", "false");
  await people.click();
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard Changes", exact: true }).click();
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await settings.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(people).toHaveAttribute("aria-checked", "false");
  await settings.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await settings.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Counting Area", exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Clear zone", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Use this Area", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Use this Area", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("camera-counting-editor.png"), fullPage: true });
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  for (const width of [1024, 760, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(settings.getByRole("button", { name: "Save Changes", exact: true })).toBeVisible();
    await expect.poll(() => settings.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("camera-settings-" + width + ".png"), fullPage: true });
  }
});

// Design review capture (DESIGN.md), tagged @design-capture: run it with `npm run capture:design`.
test("captures Dashboard and Camera Setup for design review", { tag: "@design-capture" }, async ({ page }) => {
  const folder = process.env.TANAW_DESIGN_CAPTURE;
  test.skip(!folder, "Run design captures with npm run capture:design.");
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, true, true);
  for (const theme of ["light", "dark"] as const) {
    await switchTheme(page, theme);
    await page.goto("/#/enterprise/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${folder}/dashboard-${theme}.png`, fullPage: true });
    await page.goto("/#/enterprise/cameras");
    await expect(page.getByRole("heading", { name: "Live Metrics", exact: true })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${folder}/cameras-${theme}.png` });
    await page.getByRole("button", { name: "Edit configuration" }).click();
    await expect(page.getByRole("region", { name: "Camera Settings", exact: true })).toBeVisible();
    await page.screenshot({ path: `${folder}/camera-settings-${theme}.png` });
    await page.goto("/#/enterprise/developer-settings");
    await expect(page.getByRole("heading", { name: "Developer Settings", exact: true })).toBeVisible();
    await page.screenshot({ path: `${folder}/developer-settings-${theme}.png`, fullPage: true });
  }
});
