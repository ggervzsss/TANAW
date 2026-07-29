import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { EMPTY_ML_COUNTS, type MlHealth, type MlServiceStatus } from "../services/ml-service";
import { CameraMonitoringPanel } from "./CameraMonitoringPanel";
import type { CameraPreviewState } from "./CameraVideoPreview";

describe("CameraMonitoringPanel", () => {
  it("labels the status and control block below Live Metrics", () => {
    const markup = renderToStaticMarkup(
      <CameraMonitoringPanel
        activeCam={camera}
        counts={EMPTY_ML_COUNTS}
        health={null}
        serviceStatus={null}
        serviceError={null}
        error={null}
        isRestartingService={false}
        isStarting={false}
        isStopping={false}
        isTesting={false}
        previewState="connecting"
        onRestartService={() => undefined}
        onStartProcessing={() => undefined}
        onStopProcessing={() => undefined}
        onTestConnection={() => undefined}
      />,
    );

    expect(markup).toContain("SYSTEM STATUS &amp; CONTROLS");
    expect(markup.indexOf("Live Metrics")).toBeLessThan(markup.indexOf("SYSTEM STATUS &amp; CONTROLS"));
    expect(markup.indexOf("SYSTEM STATUS &amp; CONTROLS")).toBeLessThan(markup.indexOf("ML Service Offline"));
    expect(markup).not.toMatch(/> Service<\/button>/);
    expect(markup).toContain("Test");
    expect(markup).toContain("Start");
    expect(markup).not.toContain("Profile pending");
    expect(markup).not.toContain("FPS adaptive");
    expect(markup).not.toContain("Frame Telemetry Idle");
  });

  it("shows Service only for an ML service failure and hides it after recovery", () => {
    const failedMarkup = renderPanel({
      serviceError: "ML service exited unexpectedly.",
      serviceStatus: { ...baseServiceStatus, error: "ML service exited unexpectedly.", running: false },
    });
    expect(failedMarkup).toMatch(/> Service<\/button>/);
    expect(failedMarkup).toMatch(/> Test<\/button>/);
    expect(failedMarkup).toMatch(/> Start<\/button>/);

    const recoveredMarkup = renderPanel({
      health: { status: "ok", running: false } as MlHealth,
      serviceStatus: { ...baseServiceStatus, running: true },
    });
    expect(recoveredMarkup).not.toMatch(/> Service<\/button>/);
    expect(recoveredMarkup).toMatch(/> Test<\/button>/);
    expect(recoveredMarkup).toMatch(/> Start<\/button>/);

    const uncheckedStoppedMarkup = renderPanel({
      serviceStatus: baseServiceStatus,
    });
    expect(uncheckedStoppedMarkup).not.toMatch(/> Service<\/button>/);
  });

  it("does not show Service for an ordinary camera-stream error", () => {
    const markup = renderPanel({
      activeCam: { ...camera, status: "failed" },
      error: "RTSP camera stream could not be opened.",
      health: { status: "ok", running: false } as MlHealth,
      serviceStatus: { ...baseServiceStatus, running: true },
    });

    expect(markup).toContain("Camera Failed");
    expect(markup).not.toMatch(/> Service<\/button>/);
  });

  it("keeps the camera in a starting state while an accepted start initializes", () => {
    const markup = renderPanel({
      counts: { ...EMPTY_ML_COUNTS, status: "stopped" },
      isStarting: true,
    });

    expect(markup).toContain("Camera Starting");
    expect(markup).toContain("Starting...");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain(">Start<");
  });

  it("reports model warmup as starting instead of processing", () => {
    const markup = renderPanel({
      counts: { ...EMPTY_ML_COUNTS, running: true, status: "starting" },
      isStarting: true,
    });

    expect(markup).toContain("Camera Starting");
    expect(markup).not.toContain("Camera Processing");
  });

  it("shows camera failure details through a compact status-row tooltip", () => {
    const markup = renderPanel({
      activeCam: { ...camera, status: "failed" },
      error: "RTSP camera stream could not be opened.",
    });

    expect(markup).toContain("Camera Failed");
    expect(markup).toContain('aria-label="Camera Failed details"');
    expect(markup).not.toContain("RTSP camera stream could not be opened.");
    expect(markup).not.toContain("Current system issues");
    expect(markup).not.toContain("fixed right-4 bottom-4");
  });

  it("does not claim the live preview is verified before a frame is displayed", () => {
    const reconnectingMarkup = renderPanel({
      activeCam: { ...camera, status: "running" },
      counts: { ...EMPTY_ML_COUNTS, running: true, status: "running" },
      previewState: "retrying",
    });
    expect(reconnectingMarkup).toContain("Restoring Live Preview");
    expect(reconnectingMarkup).not.toContain("Live Preview Verified");

    const liveMarkup = renderPanel({
      activeCam: { ...camera, status: "running" },
      counts: { ...EMPTY_ML_COUNTS, running: true, status: "running" },
      previewState: "live",
    });
    expect(liveMarkup).toContain("Live Preview Verified");
  });
});

function renderPanel({
  activeCam = camera,
  counts = EMPTY_ML_COUNTS,
  error = null,
  health = null,
  isStarting = false,
  previewState = "connecting",
  serviceError = null,
  serviceStatus = null,
}: {
  activeCam?: Camera;
  counts?: typeof EMPTY_ML_COUNTS;
  error?: string | null;
  health?: MlHealth | null;
  isStarting?: boolean;
  previewState?: CameraPreviewState;
  serviceError?: string | null;
  serviceStatus?: MlServiceStatus | null;
}) {
  return renderToStaticMarkup(
    <CameraMonitoringPanel
      activeCam={activeCam}
      counts={counts}
      health={health}
      serviceStatus={serviceStatus}
      serviceError={serviceError}
      error={error}
      isRestartingService={false}
      isStarting={isStarting}
      isStopping={false}
      isTesting={false}
      previewState={previewState}
      onRestartService={() => undefined}
      onStartProcessing={() => undefined}
      onStopProcessing={() => undefined}
      onTestConnection={() => undefined}
    />,
  );
}

const baseServiceStatus: MlServiceStatus = {
  baseUrl: "http://127.0.0.1:8765",
  desktopBuild: "test",
  desktopVersion: "test",
  error: null,
  packaged: false,
  pid: 123,
  running: false,
};

const camera: Camera = {
  id: 1,
  name: "Entrance Camera",
  status: "stopped",
  zone: "Main",
  rtsp: "rtsp://192.168.1.10/stream2",
  processingProfile: "auto",
  confidence: 0.35,
  config: {
    tripwire: 50,
    tripwires: {
      entry: { start: { x: 40, y: 0 }, end: { x: 40, y: 100 } },
      exit: { start: { x: 60, y: 0 }, end: { x: 60, y: 100 } },
    },
    roi: { top: 0, left: 0, width: 100, height: 100 },
    reverse: false,
  },
};
