import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { EMPTY_ML_COUNTS } from "../services/ml-service";
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
    expect(markup).toContain("Service");
    expect(markup).toContain("Test");
    expect(markup).toContain("Start");
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
  isStarting = false,
  previewState = "connecting",
}: {
  activeCam?: Camera;
  counts?: typeof EMPTY_ML_COUNTS;
  error?: string | null;
  isStarting?: boolean;
  previewState?: CameraPreviewState;
}) {
  return renderToStaticMarkup(
    <CameraMonitoringPanel
      activeCam={activeCam}
      counts={counts}
      health={null}
      serviceStatus={null}
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
