import { describe, expect, it } from "vitest";
import { MAX_ML_REPORT_LIVE_EVENT_BYTES, parseMlReportLiveEvent } from "./ml-report-live-events";

describe("ML report live-event contract", () => {
  it("accepts the camera state fields consumed by report synchronization", () => {
    expect(parseMlReportLiveEvent(JSON.stringify(cameraStatesEvent()))).toEqual(cameraStatesEvent());
  });

  it("rejects malformed, unsupported, and oversized payloads", () => {
    expect(parseMlReportLiveEvent("not-json")).toBeNull();
    expect(parseMlReportLiveEvent('{"type":"arbitrary.command","data":{}}')).toBeNull();
    expect(parseMlReportLiveEvent(JSON.stringify({ type: "camera.states", data: { cameras: [] } }))).toBeNull();
    expect(parseMlReportLiveEvent("x".repeat(MAX_ML_REPORT_LIVE_EVENT_BYTES + 1))).toBeNull();
  });

  it("accepts Open Space counts without exposing fabricated doorway totals", () => {
    const envelope = cameraStatesEvent();
    const area = { ...envelope, data: { ...envelope.data, cameras: envelope.data.cameras.map((camera) => ({
      ...camera, analysis_mode: "open_space", counts: { ...camera.counts, entry: null, exit: null, occupancy: null },
    })) } };
    expect(parseMlReportLiveEvent(JSON.stringify(area))).toEqual(area);
    delete (area.data.cameras[0] as { analysis_mode?: string }).analysis_mode;
    expect(parseMlReportLiveEvent(JSON.stringify(area))).toBeNull();
  });

  it("forwards reset instructions but rejects malformed errors and detection data", () => {
    const error = { type: "service.error", code: "local_database_reset_required", message: "Close TANAW and reset local data.", retryable: false };
    expect(parseMlReportLiveEvent(JSON.stringify(error))).toEqual(error);
    expect(parseMlReportLiveEvent(JSON.stringify({ ...error, retryable: "false" }))).toBeNull();
    const envelope = cameraStatesEvent();
    (envelope.data.cameras[0].detections as unknown) = {};
    expect(parseMlReportLiveEvent(JSON.stringify(envelope))).toBeNull();
  });
});

function cameraStatesEvent() {
  return {
    type: "camera.states" as const,
    data: {
      enterprise_id: "enterprise-1",
      enterprise_occupancy: 3,
      active_camera_count: 1,
      max_configured_cameras: 6,
      max_concurrent_cameras: 6,
      pending_camera_ids: [],
      cameras: [
        {
          camera_id: 1,
          counts: { entry: 4, exit: 1, occupancy: 3, running: true, status: "running", error: null },
          detections: { frame_width: 640, frame_height: 360, tracks: [] },
          health: {
            running: true,
            model_ready: true,
            processed_frame_stale_ms: 20,
            estimated_unique_count: 4,
            confirmed_unique_count: 3,
            degraded_unique_count: 1,
          },
          session: { running: true, status: "running", error: null },
        },
      ],
    },
  };
}
