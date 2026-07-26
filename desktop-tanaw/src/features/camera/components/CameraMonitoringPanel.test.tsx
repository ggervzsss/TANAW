import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { EMPTY_ML_COUNTS } from "../services/ml-service";
import { CameraMonitoringPanel } from "./CameraMonitoringPanel";

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
});

function renderPanel({ counts = EMPTY_ML_COUNTS, isStarting = false }: { counts?: typeof EMPTY_ML_COUNTS; isStarting?: boolean }) {
  return renderToStaticMarkup(
    <CameraMonitoringPanel
      activeCam={camera}
      counts={counts}
      health={null}
      serviceStatus={null}
      error={null}
      isRestartingService={false}
      isStarting={isStarting}
      isStopping={false}
      isTesting={false}
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
