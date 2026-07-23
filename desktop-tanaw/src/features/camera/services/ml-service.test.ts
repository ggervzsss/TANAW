import { afterEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { testCameraConnection } from "./ml-service";

describe("secure camera service requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("delegates credential injection to Electron without sending a password from renderer state", async () => {
    const request = vi.fn().mockResolvedValue({ message: "Connected", ok: true });
    vi.stubGlobal("window", {
      tanawCameraCredentials: { request },
    });

    await testCameraConnection("http://127.0.0.1:8765", camera(), "enterprise:1");

    expect(request).toHaveBeenCalledOnce();
    const payload = request.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("username");
    expect(payload.stream_url).toBe("rtsp://192.168.1.9/stream2");
  });
});

function camera(): Camera {
  return {
    cameraHost: "192.168.1.9",
    cameraType: "RTSP_CCTV",
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
    id: 1,
    name: "Entrance",
    processingProfile: "auto",
    reidMode: "auto",
    resolution: "Adaptive",
    rtsp: "rtsp://192.168.1.9/stream2",
    rtspStream: "stream2",
    status: "untested",
    trackingConfidence: 0.15,
    type: "Entry/Exit",
    uniqueCountingMode: "estimated_reid",
    username: "camera-user",
    zone: "Lobby",
  };
}
