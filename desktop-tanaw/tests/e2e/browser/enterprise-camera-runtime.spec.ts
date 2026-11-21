// Enterprise camera runtime: hydration and live events, the camera modal, and vendor setup by IP address.
import { expect, test, type Page } from "@playwright/test";
import { mlResponse, mockCameraSetup, mockMlRequest, switchTheme } from "./support/preload";
import { signIn, defaultEnterpriseUser } from "./support/session";

test("recovers camera hydration after service startup and restores live updates after disconnect", async ({ page }) => {
  test.setTimeout(60_000);
  await renderTestVideoFrames(page);
  let runtimeReads = 0;
  let profileReads = 0;
  const camera = {
    id: 1,
    name: "Live camera",
    zone: "Entrance",
    status: "stopped",
    cameraBrand: "tapo",
    cameraHost: "192.168.1.20",
    rtsp: "rtsp://192.168.1.20/stream2",
    processingProfile: "auto",
    confidence: 0.35,
    trackingConfidence: 0.15,
    config: {
      tripwire: 50,
      reverse: false,
      roi: { top: 0, left: 0, width: 100, height: 100 },
      tripwires: {
        entry: { start: { x: 42, y: 12 }, end: { x: 42, y: 88 } },
        exit: { start: { x: 58, y: 12 }, end: { x: 58, y: 88 } },
      },
    },
  };
  await signIn(page, async () => {
    await mockCameraSetup(page, defaultEnterpriseUser.enterpriseId);
    await mockMlRequest(page, "/cameras", () => {
      profileReads += 1;
      if (profileReads < 3) throw new Error("connect ECONNREFUSED: ML service still starting");
      return mlResponse({ status: 200, body: JSON.stringify([camera]) });
    });
    await mockMlRequest(page, "/cameras/runtime", () => {
      runtimeReads += 1;
      return mlResponse({
        status: 200,
        body: JSON.stringify({
          enterprise_id: defaultEnterpriseUser.enterpriseId,
          enterprise_occupancy: 0,
          active_camera_count: 0,
          max_configured_cameras: 4,
          max_concurrent_cameras: 2,
          pending_camera_ids: [],
          cameras: [],
        }),
      });
    });
  });
  await page.goto("/#/enterprise/cameras");
  await expect(page.getByRole("heading", { name: "Live camera", exact: true })).toBeVisible();
  expect(profileReads).toBeGreaterThanOrEqual(3);
  const counts = { entry: 3, exit: 1, occupancy: 2, running: true, status: "running", error: null, started_at: null };
  const envelope = {
    type: "camera.states",
    data: {
      enterprise_id: defaultEnterpriseUser.enterpriseId,
      enterprise_occupancy: 2,
      active_camera_count: 1,
      max_configured_cameras: 4,
      max_concurrent_cameras: 2,
      pending_camera_ids: [],
      cameras: [
        {
          camera_id: 1,
          counts,
          area: null,
          detections: {
            running: true,
            status: "running",
            error: null,
            frame_width: 640,
            frame_height: 360,
            tracks: [{ track_id: 7, source_track_id: 7, confidence: 0.9, bbox: [60, 50, 160, 300], centroid: [110, 175], direction: null, counting_debug: null }],
          },
          health: {
            status: "ok",
            running: true,
            error: null,
            model_ready: true,
            analytics_fps: 11.7,
            processed_frame_stale_ms: 10,
            estimated_unique_count: 3,
            confirmed_unique_count: 3,
            degraded_unique_count: 0,
          },
          session: { running: true, status: "running", error: null, counts },
        },
      ],
    },
  };
  const emit = (payload: unknown) => page.evaluate((detail) => window.dispatchEvent(new CustomEvent("e2e-ml-live-event", { detail })), payload);
  await emit(envelope);
  const performance = page.locator(".camera-page-heading").getByText(/11\.7 AI FPS/);
  await expect(performance).toBeVisible({ timeout: 1000 });
  const box = page.locator('[data-track-id="7"]');
  await expect(box).toBeVisible();
  expect(await box.evaluate((element) => (element as HTMLElement).style.left)).toBe("9.375%");
  envelope.data.cameras[0].detections.tracks[0].bbox = [300, 50, 400, 300];
  await emit(envelope);
  await expect.poll(() => box.evaluate((element) => (element as HTMLElement).style.left), { timeout: 1000 }).toBe("46.875%");
  await page.waitForTimeout(1200); // Allow the separate cloud-telemetry reconciliation to finish.
  const readsAfterLive = runtimeReads;
  // Deliberate quiet window: live events must suppress the runtime fallback poll for a whole poll
  // interval. A page clock cannot replace it because the poller's timer starts before this point.
  await page.waitForTimeout(2700);
  expect(runtimeReads).toBe(readsAfterLive);
  await emit({ type: "disconnected" });
  await expect.poll(() => runtimeReads).toBeGreaterThan(readsAfterLive);
  await emit({ type: "service.error", code: "local_database_reset_required", message: "Close TANAW and reset the local database.", retryable: false });
  await expect(page.locator(".camera-preview-feedback")).toContainText("Close TANAW and reset the local database.");
  const readsAfterReset = runtimeReads;
  // Deliberate quiet window: a reset-required error must stop polling for a whole poll interval.
  await page.waitForTimeout(2700);
  expect(runtimeReads).toBe(readsAfterReset);
  await emit({ type: "connected" });
  await emit(envelope);
  await expect(performance).toBeVisible();
});

async function renderTestVideoFrames(page: Page) {
  await page.route("**/interaction-frame.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#486456"/></svg>' }),
  );
  await page.addInitScript(() => {
    const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...source,
      set(value: string) {
        source.set!.call(this, value.startsWith("tanaw-ml://") ? new URL("/interaction-frame.svg", location.origin).href : value);
      },
    });
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return original.call(this, name, this instanceof HTMLImageElement && name === "src" && value.startsWith("tanaw-ml://") ? new URL("/interaction-frame.svg", location.origin).href : value);
    };
  });
}

test("themes the camera modal and keeps the minimized Tripwire toolbar draggable", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await renderTestVideoFrames(page);
  await signIn(page, () => mockCameraSetup(page, defaultEnterpriseUser.enterpriseId));
  await page.goto("/#/enterprise/cameras");
  const addCamera = page.getByRole("button", { name: "Add Camera", exact: true });
  await expect(addCamera).toHaveCount(1);
  await expect(addCamera).toBeVisible();
  await addCamera.click();

  let dialog = page.locator(".camera-add-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await dialog.getByLabel("Camera Name", { exact: false }).fill("Temporary camera");
  await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Camera Connection", exact: true })).toBeVisible();
  await dialog.getByLabel("Camera Password", { exact: false }).fill("secret-camera-password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(dialog.getByLabel("Camera Password", { exact: false })).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard Changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await switchTheme(page, "light");
  await addCamera.click();
  dialog = page.locator(".camera-add-dialog");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await dialog.getByLabel("Camera Name", { exact: false }).fill("Entrance");
  await dialog.getByLabel("Camera Location", { exact: false }).fill("Lobby");
  await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("127.0.0.1");
  await dialog.getByLabel("Camera Username", { exact: false }).fill("admin");
  await dialog.getByLabel("Camera Password", { exact: false }).fill("camera-password");
  await dialog.getByRole("button", { name: "Test & Add Camera", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("heading", { name: "Live Metrics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /system status|camera connection/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Camera", exact: true })).toBeVisible();

  const selectedCamera = page.getByRole("button", { name: /Entrance/, pressed: true });
  await selectedCamera.hover();
  await expect(selectedCamera).toHaveCSS("transform", "none");
  expect(Number.parseFloat(await addCamera.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThan(12);

  await page.evaluate(async (enterpriseId) => {
    const response = await window.tanawMlService!.request({ url: "http://127.0.0.1:8765/cameras", method: "GET", timeoutMs: 2500 });
    const camera = JSON.parse(response.body)[0];
    const counts = { entry: 0, exit: 0, occupancy: 0, running: true, status: "running", error: null };
    window.dispatchEvent(
      new CustomEvent("e2e-ml-live-event", {
        detail: {
          type: "camera.states",
          data: {
            enterprise_id: enterpriseId,
            enterprise_occupancy: 0,
            active_camera_count: 1,
            pending_camera_ids: [],
            cameras: [
              {
                camera_id: camera.id,
                counts,
                detections: { running: true, status: "running", frame_width: 640, frame_height: 360, tracks: [] },
                health: { status: "ok", model_ready: true, running: true, raw_frame_id: 1, raw_frame_stale_ms: 0, analytics_fps: 12 },
                area: null,
                session: { running: true, counts },
              },
            ],
          },
        },
      }),
    );
  }, defaultEnterpriseUser.enterpriseId);
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page.getByRole("tab", { name: "Counting Area", exact: true }).click();
  await page.getByRole("button", { name: "Edit Counting Area", exact: true }).click();
  await page.getByRole("button", { name: "Hide tripwire toolbar" }).click();
  const minimized = page.getByRole("button", { name: "Show tripwire toolbar" });
  const toolbar = minimized.locator("..");
  const overlay = toolbar.locator("..");
  const before = await toolbar.boundingBox();
  expect(before).not.toBeNull();

  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 120, before!.y + before!.height / 2 + 70, { steps: 5 });
  await page.mouse.up();
  const after = await toolbar.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).toBeGreaterThan(before!.x + 80);
  expect(after!.y).toBeGreaterThan(before!.y + 40);
  await expect(minimized).toBeVisible();
  await expect(page.getByRole("button", { name: "Move tripwire toolbar" })).toHaveCount(0);

  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  await page.mouse.move(after!.x + after!.width / 2, after!.y + after!.height / 2);
  await page.mouse.down();
  await page.mouse.move(overlayBox!.x - 100, overlayBox!.y - 100, { steps: 5 });
  await page.mouse.up();
  const clamped = await toolbar.boundingBox();
  expect(clamped).not.toBeNull();
  expect(clamped!.x).toBeGreaterThanOrEqual(overlayBox!.x);
  expect(clamped!.y).toBeGreaterThanOrEqual(overlayBox!.y);

  await minimized.click();
  await expect(page.getByRole("button", { name: "Move tripwire toolbar" })).toBeVisible();

  await page.getByRole("button", { name: "Use this Area", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 800, height: 500 });
  await expect(page.getByRole("heading", { name: "Camera Monitoring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Camera", exact: true })).toBeVisible();
  const narrowMetrics = page.getByRole("heading", { name: "Live Metrics" });
  await narrowMetrics.scrollIntoViewIfNeeded();
  await expect(narrowMetrics).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

async function mockStoppedCameraRuntime(page: Page, profiles: () => Array<Record<string, unknown>>) {
  await mockMlRequest(page, "/cameras/runtime", () =>
    mlResponse({
      status: 200,
      body: JSON.stringify({
        enterprise_id: defaultEnterpriseUser.enterpriseId,
        enterprise_occupancy: 0,
        active_camera_count: 0,
        pending_camera_ids: [],
        cameras: profiles().map((camera) => ({
          camera_id: camera.id,
          counts: { entry: null, exit: null, occupancy: null, running: false, status: "stopped", error: null },
          detections: { running: false, status: "stopped", frame_width: 640, frame_height: 360, tracks: [] },
          health: { status: "ok", model_ready: true, running: false },
          area: { available: false, active_visits: [] },
          session: {},
        })),
      }),
    }),
  );
}

test("sets up Tapo, Tenda and custom RTSP cameras from the IP address alone", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, () => mockCameraSetup(page, defaultEnterpriseUser.enterpriseId));
  await page.goto("/#/enterprise/cameras");
  const writes: Array<{ cameras: Array<Record<string, unknown>> }> = [];
  await mockMlRequest(page, "/cameras", (request) => {
    if (request.method === "PUT") writes.push(JSON.parse(request.body ?? "{}"));
    return mlResponse({ status: 200, body: JSON.stringify(writes.at(-1)?.cameras ?? []) });
  });
  await mockStoppedCameraRuntime(page, () => writes.at(-1)?.cameras ?? []);
  const choose = async (name: string, option: string) => {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  for (const [brand, name, ip] of [
    ["TP-Link Tapo", "Existing Tapo", "192.168.1.20"],
    ["Tenda", "New Tenda CH3", "192.168.1.21"],
    ["Custom RTSP", "Custom Camera", "192.168.1.22"],
  ]) {
    await page.getByRole("button", { name: "Add Camera", exact: true }).click();
    const dialog = page.locator(".camera-add-dialog");
    await dialog.getByLabel("Camera Name", { exact: false }).fill(name);
    await dialog.getByLabel("Camera Location", { exact: false }).fill("Lobby");
    if (brand !== "TP-Link Tapo") await choose("Camera brand / type", brand);
    await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
    if (brand === "Custom RTSP") {
      await dialog.getByRole("textbox", { name: "RTSP stream address", exact: true }).fill(`rtsp://${ip}:9554/live?channel=2&subtype=0`);
    } else {
      await dialog.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill(ip);
      for (const hidden of ["Video quality", "RTSP port", "Stream path and query", "Tenda connection profile", "Advanced connection settings"]) {
        await expect(dialog.getByText(hidden, { exact: true })).toHaveCount(0);
      }
    }
    await dialog.getByLabel("Camera Username", { exact: false }).fill("admin");
    await dialog.getByLabel("Camera Password", { exact: false }).fill("device-password");
    if (brand === "Tenda") await page.screenshot({ path: test.info().outputPath("tenda-setup.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Test & Add Camera", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => writes.at(-1)?.cameras.length).toBe(brand === "TP-Link Tapo" ? 1 : brand === "Tenda" ? 2 : 3);
  }
  // The Tenda address is the one the connection test found working, not a user choice.
  expect(writes.at(-1)?.cameras.map((camera) => camera.rtsp)).toEqual(["rtsp://192.168.1.20/stream2", "rtsp://192.168.1.21:8554/profile1", "rtsp://192.168.1.22:9554/live?channel=2&subtype=0"]);
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "RTSP stream address", exact: true })).toHaveValue("rtsp://192.168.1.22:9554/live?channel=2&subtype=0");
  await page.getByRole("textbox", { name: "RTSP stream address", exact: true }).fill("rtsp://192.168.1.22:9554/live?channel=3&subtype=1");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  expect(writes.at(-1)?.cameras[2]?.rtsp).toBe("rtsp://192.168.1.22:9554/live?channel=3&subtype=1");
  expect(writes.at(-1)?.cameras[0]?.rtsp).toBe("rtsp://192.168.1.20/stream2");
  expect(JSON.stringify(writes)).not.toContain("device-password");
  await page.getByRole("button", { name: /New Tenda CH3/ }).click();
  await page.getByRole("button", { name: "Edit configuration" }).click();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Camera IP Address", exact: true })).toHaveValue("192.168.1.21");
  await expect(page.getByText("Video Stream", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.25");
  await page.getByRole("button", { name: "Test Camera Connection", exact: true }).click();
  await expect(page.getByText("Camera connection verified", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  await expect.poll(() => writes.at(-1)?.cameras[1]).toMatchObject({ cameraHost: "192.168.1.25", rtsp: "rtsp://192.168.1.25:8554/profile1" });
  await switchTheme(page, "light");
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  await choose("Camera brand / type", "Tenda");
  await page.getByLabel("Camera Name", { exact: false }).fill("Small window camera");
  await page.locator(".camera-add-dialog").getByRole("button", { name: "Add Camera", exact: true }).click();
  await page.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.23");
  await page.setViewportSize({ width: 375, height: 812 });
  const dialog = page.locator(".camera-add-dialog");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("tenda-setup-small-light.png"), fullPage: true });
});

test("adds and edits a Dahua camera from its IP address", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, () => mockCameraSetup(page, defaultEnterpriseUser.enterpriseId));
  await page.goto("/#/enterprise/cameras");
  const writes: Array<{ cameras: Array<Record<string, unknown>> }> = [];
  await mockMlRequest(page, "/cameras", (request) => {
    if (request.method === "PUT") writes.push(JSON.parse(request.body ?? "{}"));
    return mlResponse({ status: 200, body: JSON.stringify(writes.at(-1)?.cameras ?? []) });
  });
  await mockStoppedCameraRuntime(page, () => writes.at(-1)?.cameras ?? []);
  const choose = async (name: string, option: string) => {
    await page.getByRole("combobox", { name, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await page.getByRole("button", { name: "Add Camera", exact: true }).click();
  const dialog = page.locator(".camera-add-dialog");
  await choose("Camera brand / type", "Dahua");
  await dialog.getByLabel("Camera Name", { exact: false }).fill("Dahua B200");
  await dialog.getByLabel("Camera Location", { exact: false }).fill("Entrance");
  await dialog.getByRole("button", { name: "Add Camera", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.23");
  await dialog.getByLabel("Camera Username", { exact: false }).fill("admin");
  await dialog.getByLabel("Camera Password", { exact: false }).fill("device-password");
  await expect(dialog.getByText("Use the camera's own username and password", { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("dahua-setup.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Test & Add Camera", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => writes.at(-1)?.cameras[0])
    .toMatchObject({
      cameraBrand: "dahua",
      rtsp: "rtsp://192.168.1.23:554/cam/realmonitor?channel=1&subtype=1",
    });

  await page.getByRole("button", { name: "Edit configuration" }).click();
  await expect(page.getByRole("combobox", { name: "Camera brand / type" })).toContainText("Dahua");
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page.getByRole("textbox", { name: "Camera IP Address", exact: true }).fill("192.168.1.24");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit configuration" })).toBeVisible();
  await expect
    .poll(() => writes.at(-1)?.cameras[0])
    .toMatchObject({
      cameraBrand: "dahua",
      cameraHost: "192.168.1.24",
      rtsp: "rtsp://192.168.1.24:554/cam/realmonitor?channel=1&subtype=1",
    });
  expect(JSON.stringify(writes)).not.toContain("device-password");
});
