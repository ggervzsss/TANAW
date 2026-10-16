import { describe, expect, it } from "vitest";
import type { Camera, CameraStatus } from "../../../types/enterprise";
import { getCameraStorageFingerprint, normalizeCamera, redactCameraForStorage } from "./camera-management";

describe("camera profile persistence", () => {
  it.each(["tenda", "custom"] as const)("preserves %s endpoints and brand through storage and reload", (cameraBrand) => {
    const rtsp = "rtsp://192.168.100.136:8554/H264?ch=1&subtype=0";
    const original: Camera = { ...camera("stopped"), cameraBrand, connectionProfile: "manual", rtsp, username: "admin", password: "secret" };
    const stored = redactCameraForStorage(original);
    expect(stored.username).toBeUndefined();
    expect(stored.password).toBeUndefined();
    expect(normalizeCamera(stored)).toMatchObject({ cameraBrand, rtsp, connectionProfile: "manual" });
  });

  it("keeps Tapo as the default for existing camera profiles", () => {
    expect(normalizeCamera(camera("stopped"))).toMatchObject({ cameraBrand: "tapo", rtsp: "rtsp://192.168.100.136/stream2" });
  });

  it("preserves a Dahua main stream and custom port through storage and reload", () => {
    const original: Camera = { ...camera("stopped"), cameraBrand: "dahua", rtspStream: "stream1", rtsp: "rtsp://192.168.100.136:9554/cam/realmonitor?channel=1&subtype=0", username: "admin", password: "secret" };
    const stored = redactCameraForStorage(original);
    expect(stored.username).toBeUndefined();
    expect(stored.password).toBeUndefined();
    expect(normalizeCamera(stored)).toMatchObject({ cameraBrand: "dahua", rtspStream: "stream1", rtsp: original.rtsp });
  });
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
