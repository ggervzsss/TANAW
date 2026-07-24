import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { CAMERA_IP_CONFLICT_MESSAGE, assertUniqueCameraIps, canonicalizeCameraIp, findCameraIpConflict } from "./camera-ip-uniqueness";

describe("camera IP uniqueness", () => {
  it("treats equivalent IPv4 spellings and RTSP stream variants as the same camera IP", () => {
    const cameras = [camera(1, "192.168.001.009", "stream1")];

    expect(findCameraIpConflict(cameras, "192.168.1.9")?.id).toBe(1);
    expect(() => assertUniqueCameraIps([...cameras, camera(2, "192.168.1.9", "stream2")])).toThrow(CAMERA_IP_CONFLICT_MESSAGE);
  });

  it("allows an edit to retain its own IP and allows different tenant lists to reuse it", () => {
    const firstTenant = [camera(1, "192.168.1.9")];
    const secondTenant = [camera(2, "192.168.1.9")];

    expect(findCameraIpConflict(firstTenant, "192.168.001.009", 1)).toBeUndefined();
    expect(() => assertUniqueCameraIps(firstTenant)).not.toThrow();
    expect(() => assertUniqueCameraIps(secondTenant)).not.toThrow();
  });

  it("canonicalizes both the host field and generated stream URL", () => {
    expect(canonicalizeCameraIp(camera(1, "192.168.001.009"))).toMatchObject({
      cameraHost: "192.168.1.9",
      rtsp: "rtsp://192.168.1.9/stream2",
    });
  });
});

function camera(id: number, host: string, stream: "stream1" | "stream2" = "stream2"): Camera {
  return {
    cameraHost: host,
    confidence: 0.35,
    config: {
      reverse: false,
      roi: { height: 100, left: 0, top: 0, width: 100 },
      tripwire: 50,
      tripwires: {
        entry: { end: { x: 42, y: 88 }, start: { x: 42, y: 12 } },
        exit: { end: { x: 58, y: 88 }, start: { x: 58, y: 12 } },
      },
    },
    fps: 0,
    id,
    name: `Camera ${id}`,
    processingProfile: "auto",
    reidMode: "auto",
    resolution: "Adaptive",
    rtsp: `rtsp://${host}/${stream}`,
    rtspStream: stream,
    status: "untested",
    trackingConfidence: 0.15,
    type: "Entry/Exit",
    uniqueCountingMode: "estimated_reid",
    username: "camera-user",
    zone: "Lobby",
  };
}
