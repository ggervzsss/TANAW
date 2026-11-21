// Camera preview and Live Metrics: stream startup, the preview toolbar, and the metrics line field.
import { expect, test } from "@playwright/test";
import { switchTheme } from "./support/preload";
import { openSettings, settings, setup } from "./support/cameraSetup";

test.describe.configure({ timeout: 60_000 });

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
  const firstFrame = new Promise<void>((resolve) => {
    releaseFrame = resolve;
  });
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
    await expect
      .poll(async () => {
        const image = await video.boundingBox();
        const polygonBox = await overlay.boundingBox();
        if (!image || !polygonBox) return Number.POSITIVE_INFINITY;
        const fittedWidth = Math.min(image.width, (image.height * 16) / 9);
        const fittedHeight = Math.min(image.height, (image.width * 9) / 16);
        return Math.max(
          Math.abs(polygonBox.width - fittedWidth),
          Math.abs(polygonBox.height - fittedHeight),
          Math.abs(polygonBox.x - (image.x + (image.width - fittedWidth) / 2)),
          Math.abs(polygonBox.y - (image.y + (image.height - fittedHeight) / 2)),
        );
      })
      .toBeLessThan(2);
  };
  const assertToolbarEdge = async () => {
    await expect
      .poll(() =>
        preview.evaluate((element) => {
          const stage = element.querySelector(".camera-video-preview")!.getBoundingClientRect();
          const actions = element.querySelector(".camera-preview-actions")!.getBoundingClientRect();
          return Math.abs(stage.right - actions.right);
        }),
      )
      .toBeLessThan(2);
  };
  const assertWidePanelLayout = async () => {
    await expect
      .poll(() =>
        selected.evaluate((element) => {
          const layout = element.querySelector(".camera-preview-layout")!;
          const previewBox = layout.querySelector(".camera-preview-surface")!.getBoundingClientRect();
          const metricsBox = layout.querySelector(".camera-live-metrics")!.getBoundingClientRect();
          return Math.max(
            Math.abs(previewBox.top - metricsBox.top),
            Math.abs(previewBox.bottom - metricsBox.bottom),
            layout.scrollWidth - layout.clientWidth,
            layout.scrollHeight - layout.clientHeight,
          );
        }),
      )
      .toBeLessThan(2);
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
  await switchTheme(page, "dark");
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
  await switchTheme(page, "light");
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
  // Compare decoded pixels. Chromium can encode identical pixels into different
  // toDataURL() bytes, which made "back to rest" flaky and "moved" vacuous.
  const picture = () =>
    lines.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0x811c9dc5;
      for (const value of data) hash = Math.imul(hash ^ value, 0x01000193);
      return `${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16)}`;
    });
  const isHovered = () => ambience.evaluate((element) => element.matches(":hover"));
  const rest = await picture();
  const palette = () =>
    ambience.evaluate((element) =>
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
  expect(await isHovered()).toBe(true);
  await expect.poll(picture).not.toBe(rest);
  const right = await picture();
  expect(await palette()).toEqual(calmPalette);
  await hoverAt(0.2);
  await expect.poll(picture).not.toBe(right);
  await expect.poll(picture).not.toBe(rest);
  await page.getByRole("heading", { name: "Live Metrics", exact: true }).hover();
  // The heading sits above the effect region, so the pointer has left it.
  expect(await isHovered()).toBe(false);
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
  await switchTheme(page, "dark");
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
