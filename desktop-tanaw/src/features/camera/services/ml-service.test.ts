import { afterEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { replaceLocalCameras, testCameraConnection } from "./ml-service";

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
    expect(payload).not.toHaveProperty("camera_type");
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("username");
    expect(payload.stream_url).toBe("rtsp://192.168.1.9/stream2");
  });
});

describe("camera configuration write boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects duplicate canonical IPs before calling the local service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(replaceLocalCameras("http://127.0.0.1:8765", [camera(), { ...camera(), id: 2, cameraHost: "192.168.001.009", rtsp: "rtsp://192.168.001.009/stream1" }])).rejects.toMatchObject({
      code: "camera_ip_conflict",
      field: "camera_ip",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes canonical IPs without including camera credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([camera()]), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });

    await replaceLocalCameras("http://127.0.0.1:8765", [
      {
        ...camera(),
        cameraHost: "192.168.001.009",
        password: undefined,
        rtsp: "rtsp://192.168.001.009/stream2",
      },
    ]);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as { cameras: Camera[] };
    expect(payload.cameras[0]?.cameraHost).toBe("192.168.1.9");
    expect(payload.cameras[0]?.rtsp).toBe("rtsp://192.168.1.9/stream2");
    expect(payload.cameras[0]).not.toHaveProperty("password");
  });
});

function camera(): Camera {
  return {
    cameraHost: "192.168.1.9",
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
    id: 1,
    name: "Entrance",
    processingProfile: "auto",
    reidMode: "auto",
    rtsp: "rtsp://192.168.1.9/stream2",
    rtspStream: "stream2",
    status: "untested",
    trackingConfidence: 0.15,
    uniqueCountingMode: "estimated_reid",
    username: "camera-user",
    zone: "Lobby",
  };
}
