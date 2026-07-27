import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import type { MlCameraLiveState, MlCameraStates, MlServiceStatus } from "../../camera/services/ml-service";
import { buildCameraMonitoringSummary } from "./camera-monitoring";

const serviceStatus: MlServiceStatus = {
  baseUrl: "http://127.0.0.1:8001",
  desktopBuild: "test",
  desktopVersion: "test",
  error: null,
  packaged: false,
  pid: 123,
  running: true,
};

describe("buildCameraMonitoringSummary", () => {
  it("reports not configured when the desktop has no cameras", () => {
    expect(buildCameraMonitoringSummary([], cameraStates([]), serviceStatus)).toMatchObject({
      status: "not_configured",
      configuredCameraCount: 0,
      activeCameraCount: 0,
    });
  });

  it("reports fully running only when every configured camera processes fresh frames", () => {
    const cameras = [camera(1), camera(2)];
    const result = buildCameraMonitoringSummary(
      cameras,
      cameraStates([runtime(1, { processedFrameStaleMs: 100 }), runtime(2, { processedFrameStaleMs: 300 })]),
      serviceStatus,
    );

    expect(result).toMatchObject({
      status: "running",
      configuredCameraCount: 2,
      activeCameraCount: 2,
      healthyCameraCount: 2,
      startingCameraCount: 0,
      stoppedCameraCount: 0,
      errorCameraCount: 0,
    });
  });

  it("reports partial monitoring while a camera is starting or has stale frames", () => {
    const cameras = [camera(1), camera(2)];
    const result = buildCameraMonitoringSummary(
      cameras,
      cameraStates([runtime(1), runtime(2, { processedFrameStaleMs: 8_000 })]),
      serviceStatus,
    );

    expect(result).toMatchObject({
      status: "partial",
      healthyCameraCount: 1,
      startingCameraCount: 1,
      activeCameraCount: 2,
    });
  });

  it("reports stopped when no configured camera has an active runtime", () => {
    const result = buildCameraMonitoringSummary([camera(1), camera(2)], cameraStates([]), serviceStatus);

    expect(result).toMatchObject({
      status: "stopped",
      stoppedCameraCount: 2,
      activeCameraCount: 0,
    });
  });

  it("prioritizes an explicit camera fault over a partial state", () => {
    const result = buildCameraMonitoringSummary(
      [camera(1), camera(2)],
      cameraStates([runtime(1), runtime(2, { error: "RTSP stream disconnected" })]),
      serviceStatus,
    );

    expect(result).toMatchObject({
      status: "error",
      healthyCameraCount: 1,
      errorCameraCount: 1,
    });
  });

  it("prefers a recovered live runtime over a stale stored error status", () => {
    const recoveredCamera = { ...camera(1), status: "error" as const };
    const result = buildCameraMonitoringSummary(
      [recoveredCamera],
      cameraStates([runtime(1)]),
      serviceStatus,
    );

    expect(result).toMatchObject({
      status: "running",
      healthyCameraCount: 1,
      errorCameraCount: 0,
    });
  });
});

function camera(id: number): Camera {
  return {
    id,
    name: `Camera ${id}`,
    status: "stopped",
    zone: "Entrance",
    rtsp: `rtsp://192.168.1.${id}/stream2`,
    processingProfile: "balanced",
    confidence: 0.5,
    config: {
      tripwire: 50,
      tripwires: {
        entry: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
        exit: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
      },
      roi: { top: 0, left: 0, width: 1, height: 1 },
      reverse: false,
    },
  };
}

function cameraStates(cameras: MlCameraLiveState[]): MlCameraStates {
  return {
    enterprise_id: "enterprise-1",
    enterprise_occupancy: 0,
    active_camera_count: cameras.filter((item) => item.counts.running).length,
    max_concurrent_cameras: 4,
    pending_camera_ids: [],
    cameras,
  };
}

function runtime(
  cameraId: number,
  {
    processedFrameStaleMs = 100,
    error = null,
  }: { processedFrameStaleMs?: number | null; error?: string | null } = {},
): MlCameraLiveState {
  return {
    camera_id: cameraId,
    counts: { running: true, status: error ? "error" : "running", error },
    session: { running: true, error: null },
    health: {
      running: true,
      error: null,
      model_ready: true,
      processed_frame_stale_ms: processedFrameStaleMs,
    },
  } as MlCameraLiveState;
}
