import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMlCounts, getMlHealth, getStreamUrl, subscribeMlCameraEvents } from "./ml-service";

const request = vi.fn();
const getStatus = vi.fn();
let cameraListener: ((event: unknown) => void) | null = null;

beforeEach(() => {
  request.mockReset();
  getStatus.mockReset();
  cameraListener = null;
  getStatus.mockResolvedValue({ baseUrl: "tanaw-ml://local", error: null, pid: 123, running: true });
  vi.stubGlobal("window", {
    tanawMlService: {
      getStatus,
      onCameraEvent(listener: (event: unknown) => void) {
        cameraListener = listener;
        return () => {
          cameraListener = null;
        };
      },
      request,
    },
  });
});

describe("renderer ML service bridge", () => {
  it("uses named IPC operations and ignores renderer-supplied base URLs", async () => {
    request.mockResolvedValueOnce({ status: "ok" }).mockResolvedValueOnce({ entry: 0 });

    await getMlHealth("http://attacker.example/steal");
    await getMlCounts("http://127.0.0.1:8765");

    expect(request).toHaveBeenNthCalledWith(1, "camera.health", undefined);
    expect(request).toHaveBeenNthCalledWith(2, "camera.counts", undefined);
    expect(JSON.stringify(request.mock.calls)).not.toContain("attacker.example");
    expect(JSON.stringify(request.mock.calls)).not.toContain("8765");
  });

  it("returns only the controlled stream protocol without credentials or tokens", () => {
    const url = getStreamUrl("http://127.0.0.1:8765?token=master", 7, false);

    expect(url).toBe("tanaw-ml://stream/?overlay=0&v=7");
    expect(url).not.toMatch(/token|password|authorization|127\.0\.0\.1/i);
  });

  it("forwards only typed camera and connection events from preload", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMlCameraEvents(listener);
    await Promise.resolve();
    cameraListener?.({ type: "arbitrary.command", data: { token: "secret" } });
    cameraListener?.({ type: "service.connection", data: { connected: true } });
    cameraListener?.({ type: "heartbeat" });

    expect(listener).toHaveBeenCalledWith({ type: "service.connection", data: { connected: true } });
    expect(listener).toHaveBeenCalledWith({ type: "heartbeat" });
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: "arbitrary.command" }));

    unsubscribe();
    expect(cameraListener).toBeNull();
  });
});
