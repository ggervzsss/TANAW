import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../../../../src/types/enterprise";
import { EMPTY_ML_COUNTS, type MlAreaState, type MlHealth, type MlServiceStatus } from "../../../../../../src/features/camera/services/ml-service";
import { CameraMonitoringPanel } from "../../../../../../src/features/camera/components/CameraMonitoringPanel";
import { CameraLiveMetrics } from "../../../../../../src/features/camera/components/CameraLiveMetrics";
import type { CameraPreviewState } from "../../../../../../src/features/camera/components/CameraVideoPreview";

describe("CameraLiveMetrics", () => {
  it("does not fabricate a zero visitor estimate when health has not supplied one", () => {
    const counts = { ...EMPTY_ML_COUNTS, entry: null, exit: null, occupancy: null };
    const markup = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady counts={counts} health={null} />);
    expect(markup).not.toContain(">0</div>");
    expect(markup).toContain("Unavailable");
  });
  it("uses the zone visitor estimate and keeps tracking gaps internal", () => {
    const area: MlAreaState = {
      available: true,
      presence: 3,
      temporarily_missing: 1,
      active_visits: [],
      last_observed_at: null,
      zone_name: "Plaza",
      revision_id: "r1",
      unique_visitors: 7,
      unique_visitors_available: true,
    };
    const activeCam: Camera = { ...camera, analysisMode: "open_space", openSpace: null };
    const markup = renderToStaticMarkup(<CameraLiveMetrics activeCam={activeCam} area={area} runtimeReady counts={EMPTY_ML_COUNTS} health={{ estimated_unique_count: 99 } as MlHealth} />);
    expect(markup).toContain("Unique Visitors");
    expect(markup).toContain(">7</div>");
    expect(markup).not.toContain(">99</div>");
    expect(markup).not.toContain("Tracking gaps");
    expect(markup).toContain("today in this zone");
    const unavailable = renderToStaticMarkup(<CameraLiveMetrics activeCam={activeCam} area={{ ...area, unique_visitors: null, unique_visitors_available: false }} runtimeReady counts={EMPTY_ML_COUNTS} health={null} />);
    expect(unavailable).toContain("Identification unavailable");
    expect(unavailable).not.toContain(">0</div>");
  });
  it.each([
    { occupancy: 0, entry: 500, exit: 500, visitors: 400, tone: "calm" },
    { occupancy: 3, entry: 20, exit: 20, visitors: 30, tone: "moderate" },
    { occupancy: 3, entry: 0, exit: 20, visitors: 30, tone: "calm" },
    { occupancy: 3, entry: 20, exit: 0, visitors: 30, tone: "calm" },
    { occupancy: 3, entry: 20, exit: 20, visitors: 0, tone: "calm" },
    { occupancy: 14, entry: 20, exit: 20, visitors: 0, tone: "high" },
    { occupancy: null, entry: 20, exit: 20, visitors: 30, tone: "muted" },
  ])("combines occupancy $occupancy, crossings $entry/$exit, and visitors $visitors into $tone", ({ occupancy, entry, exit, visitors, tone }) => {
    const counts = { ...EMPTY_ML_COUNTS, occupancy, entry, exit, running: true, status: "running" };
    const health = { estimated_unique_count: visitors } as MlHealth;
    const markup = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady counts={counts} health={health} />);

    expect(markup).toContain(`data-ambience-tone="${tone}"`);
  });
  it("uses muted, calm, and attention tones for unavailable, paused, and reconnecting readings", () => {
    const counts = { ...EMPTY_ML_COUNTS, occupancy: 25 };
    const unavailable = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady={false} counts={counts} health={null} />);
    const paused = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady counts={counts} health={null} />);
    const reconnecting = renderToStaticMarkup(
      <CameraLiveMetrics activeCam={camera} runtimeReady counts={{ ...counts, running: true, status: "reconnecting" }} health={null} />,
    );

    expect(unavailable).toContain('data-ambience-tone="muted"');
    expect(paused).toContain('data-ambience-tone="calm"');
    expect(reconnecting).toContain('data-ambience-tone="attention"');
  });
  it("shows value placeholders while the first readings load, and real values once they arrive", () => {
    const counts = { ...EMPTY_ML_COUNTS, occupancy: null, entry: null, exit: null };
    const loading = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady={false} loading counts={counts} health={null} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("tanaw-skeleton");
    expect(loading).not.toContain("—");
    expect(loading).toContain("Establishment Occupancy");

    const loaded = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady loading counts={{ ...counts, occupancy: 4 }} health={null} />);
    expect(loaded).toContain(">4</div>");
  });
  it("keeps an observed zero and suppresses cached values when runtime is unavailable", () => {
    const counts = { ...EMPTY_ML_COUNTS, occupancy: 0, entry: 3, exit: 3 };
    const live = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady counts={counts} health={null} />);
    const unavailable = renderToStaticMarkup(<CameraLiveMetrics activeCam={camera} runtimeReady={false} counts={counts} health={null} />);

    expect(live).toContain(">0</div>");
    expect(unavailable).not.toContain(">0</div>");
    expect(unavailable).not.toContain(">3</div>");
  });
});

describe("CameraMonitoringPanel", () => {
  it("keeps service diagnostics available in camera settings", () => {
    const markup = renderPanel({});

    expect(markup).toContain("SYSTEM STATUS &amp; CONTROLS");
    expect(markup).not.toContain("Live Metrics");
    expect(markup.indexOf("SYSTEM STATUS &amp; CONTROLS")).toBeLessThan(markup.indexOf("ML Service Offline"));
    expect(markup).not.toMatch(/> Service<\/button>/);
    expect(markup).toContain("Test");
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

    const recoveredMarkup = renderPanel({
      health: { status: "ok", running: false } as MlHealth,
      serviceStatus: { ...baseServiceStatus, running: true },
    });
    expect(recoveredMarkup).not.toMatch(/> Service<\/button>/);
    expect(recoveredMarkup).toMatch(/> Test<\/button>/);

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

  it("does not describe cached camera health as a healthy service after a terminal error", () => {
    const markup = renderPanel({ health: { status: "ok", running: true } as MlHealth, serviceError: "Close TANAW and reset the local database." });
    expect(markup).toContain("ML Service Needs Attention");
    expect(markup).not.toContain("ML Service Running");
    expect(markup).toContain('aria-label="ML Service Needs Attention details"');
  });

  it("keeps the camera in a starting state while an accepted start initializes", () => {
    const markup = renderPanel({
      counts: { ...EMPTY_ML_COUNTS, status: "stopped" },
      isStarting: true,
    });

    expect(markup).toContain("Camera Starting");
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
      isTesting={false}
      previewState={previewState}
      onRestartService={() => undefined}
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
