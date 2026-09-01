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
          detections: {},
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
