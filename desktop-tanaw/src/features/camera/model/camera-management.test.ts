import { describe, expect, it } from "vitest";
import type { Camera, CameraStatus } from "../../../types/enterprise";
import { getCameraStorageFingerprint, redactCameraForStorage } from "./camera-management";

describe("camera profile persistence", () => {
  it.each<CameraStatus>(["untested", "online", "offline", "starting", "connecting", "running", "degraded", "reconnecting", "stopped", "failed", "error"])(
    "does not persist the %s runtime status",
    (status) => {
      expect(redactCameraForStorage(camera(status))).toMatchObject({ status: "stopped" });
    },
  );

  it("keeps the persistence fingerprint stable across runtime-only changes", () => {
    const stopped = camera("stopped");
    const starting = { ...stopped, status: "starting" as const };
    const running = { ...stopped, status: "running" as const };

    expect(getCameraStorageFingerprint([starting])).toBe(getCameraStorageFingerprint([stopped]));
    expect(getCameraStorageFingerprint([running])).toBe(getCameraStorageFingerprint([stopped]));
  });

  it("changes the persistence fingerprint when configuration changes", () => {
    const original = camera("stopped");

    expect(getCameraStorageFingerprint([{ ...original, zone: "Entrance" }])).not.toBe(getCameraStorageFingerprint([original]));
  });
});

function camera(status: CameraStatus): Camera {
  return {
    id: 1,
    name: "TAPO C310",
    status,
    zone: "Lobby",
    rtsp: "rtsp://192.168.100.136/stream2",
    cameraHost: "192.168.100.136",
    rtspStream: "stream2",
    processingProfile: "auto",
    confidence: 0.35,
    trackingConfidence: 0.15,
    reidMode: "auto",
    uniqueCountingMode: "estimated_reid",
    config: {
      tripwire: 50,
      tripwires: {
        entry: { start: { x: 42, y: 12 }, end: { x: 42, y: 88 } },
        exit: { start: { x: 58, y: 12 }, end: { x: 58, y: 88 } },
      },
      roi: { top: 0, left: 0, width: 100, height: 100 },
      reverse: false,
    },
  };
}
