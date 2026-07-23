import { describe, expect, it } from "vitest";
import type { MlCameraLiveState, MlCameraStates } from "../services/ml-service";
import {
  clearRecoveredCameraRequestErrors,
  mergeCameraStates,
} from "./camera-live-state";

describe("mergeCameraStates", () => {
  it("keeps delayed updates attached to their source camera while another camera is selected", () => {
    const first = state(101, 4);
    const second = state(202, 8);
    const initial = mergeCameraStates({}, payload(first, second), new Set([101, 202]));

    // Selection is intentionally unrelated to state routing. A delayed camera 101
    // event must not overwrite camera 202's metrics.
    const selectedCameraId = 202;
    const updated = mergeCameraStates(initial, payload(state(101, 5)), new Set([101, 202]));

    expect(updated[101].counts.entry).toBe(5);
    expect(updated[selectedCameraId].counts.entry).toBe(8);
  });

  it("drops states outside the active enterprise camera set", () => {
    const updated = mergeCameraStates({ 101: state(101, 1), 999: state(999, 9) }, payload(state(999, 10)), new Set([101]));
    expect(Object.keys(updated)).toEqual(["101"]);
  });
});

describe("clearRecoveredCameraRequestErrors", () => {
  it("clears a stale request timeout after runtime confirms startup is progressing", () => {
    const errors = {
      101: "Error invoking remote method 'camera-credentials:request': TimeoutError: The operation was aborted due to timeout",
    };
    const starting = state(101, 0);
    starting.counts.status = "connecting";

    expect(clearRecoveredCameraRequestErrors(errors, [starting])).toEqual({});
  });

  it("keeps real pipeline failures and unrelated validation errors", () => {
    const failed = state(101, 0);
    failed.counts.running = false;
    failed.counts.status = "failed";
    failed.counts.error = "Unable to initialize ML model.";
    const errors = {
      101: "The ML service did not respond in time.",
      202: "Enter the camera password.",
    };

    expect(clearRecoveredCameraRequestErrors(errors, [failed, state(202, 0)])).toBe(errors);
  });
});

function payload(...cameras: MlCameraLiveState[]): MlCameraStates {
  return { enterprise_id: "enterprise-1", enterprise_occupancy: 0, active_camera_count: cameras.length, max_concurrent_cameras: 2, cameras };
}

function state(cameraId: number, entries: number): MlCameraLiveState {
  const counts = { entry: entries, exit: 0, occupancy: entries, running: true, status: "running", started_at: null, error: null };
  return {
    enterprise_id: "enterprise-1",
    camera_id: cameraId,
    counts,
    detections: { running: true, status: "running", error: null, frame_width: null, frame_height: null, tracks: [] },
    health: {
      status: "ok",
      running: true,
      error: null,
      active_camera_count: 1,
      max_concurrent_cameras: 2,
    } as MlCameraLiveState["health"],
    session: { running: true, status: "running", error: null, camera_id: cameraId, camera_name: `Camera ${cameraId}`, camera_config: null, counts, updated_at: null },
  };
}
