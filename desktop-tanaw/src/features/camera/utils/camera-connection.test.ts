import { describe, expect, it } from "vitest";
import { getRtspEndpoint, updateCameraConnection, validateCameraConnection, type CameraConnection } from "./camera-connection";

const tapo: CameraConnection = { cameraHost: "192.168.1.20", rtspStream: "stream2", rtsp: "rtsp://192.168.1.20/stream2" };

describe("camera connection profiles", () => {
  it("preserves the default Tapo URLs and quality selection", () => {
    expect(updateCameraConnection(tapo, { cameraHost: "192.168.1.21" }).rtsp).toBe("rtsp://192.168.1.21/stream2");
    expect(updateCameraConnection(tapo, { rtspStream: "stream1" }).rtsp).toBe("rtsp://192.168.1.20/stream1");
    expect(validateCameraConnection(tapo)).toBeUndefined();
  });

  it("switches brands per camera without retaining a Tapo stream path for Tenda", () => {
    const tenda = updateCameraConnection(tapo, { cameraBrand: "tenda" });
    expect(tenda.rtsp).toBe("rtsp://192.168.1.20:554/ch=1?subtype=1");
    expect(updateCameraConnection(tenda, { cameraBrand: "tapo" }).rtsp).toBe(tapo.rtsp);
    expect(tapo.cameraBrand).toBeUndefined();
  });

  it.each([
    ["channel", "554/ch=1?subtype=0"],
    ["channel_ampersand", "554/ch=1&subtype=0"],
    ["profile", "8554/profile0"],
    ["h264", "554/H264?ch=1&subtype=0"],
  ] as const)("builds the %s Tenda main stream", (connectionProfile, endpoint) => {
    const tenda = updateCameraConnection(tapo, { cameraBrand: "tenda" });
    const next = updateCameraConnection(tenda, { connectionProfile, rtspStream: "stream1" });
    expect(next.rtsp).toBe(`rtsp://192.168.1.20:${endpoint}`);
    expect(validateCameraConnection(next)).toBeUndefined();
  });

  it("preserves a manual Tenda endpoint while changing its IP", () => {
    const tenda: CameraConnection = { ...tapo, cameraBrand: "tenda", connectionProfile: "manual", rtsp: "rtsp://192.168.1.20:9554/live?channel=2&quality=high" };
    expect(updateCameraConnection(tenda, { cameraHost: "192.168.1.21" }).rtsp).toBe("rtsp://192.168.1.21:9554/live?channel=2&quality=high");
    expect(getRtspEndpoint(tenda.rtsp)).toEqual({ port: "9554", path: "/live?channel=2&quality=high" });
  });

  it("switches to Dahua with its standard stream and resets the previous brand profile", () => {
    const tenda: CameraConnection = { ...tapo, cameraBrand: "tenda", connectionProfile: "profile", rtsp: "rtsp://192.168.1.20:8554/profile1" };
    const dahua = updateCameraConnection(tenda, { cameraBrand: "dahua" });
    expect(dahua.rtsp).toBe("rtsp://192.168.1.20:554/cam/realmonitor?channel=1&subtype=1");
    expect(dahua.connectionProfile).toBeUndefined();
    expect(validateCameraConnection(dahua)).toBeUndefined();
    expect(updateCameraConnection(dahua, { cameraBrand: "tapo" }).rtsp).toBe(tapo.rtsp);
    expect(updateCameraConnection(dahua, { cameraBrand: "custom" }).rtsp).toBe(dahua.rtsp);
  });

  it("preserves Dahua's custom port when changing quality and IP", () => {
    const dahua = updateCameraConnection(tapo, { cameraBrand: "dahua" });
    const customPort = updateCameraConnection(dahua, { rtsp: "rtsp://192.168.1.20:9554/cam/realmonitor?channel=1&subtype=1" });
    const high = updateCameraConnection(customPort, { cameraHost: "192.168.1.21", rtspStream: "stream1" });
    expect(high.rtsp).toBe("rtsp://192.168.1.21:9554/cam/realmonitor?channel=1&subtype=0");
    expect(validateCameraConnection(high)).toBeUndefined();
    expect(updateCameraConnection(high, { rtspStream: "stream2" }).rtsp).toBe("rtsp://192.168.1.21:9554/cam/realmonitor?channel=1&subtype=1");
  });

  it.each(["rtsp://192.168.1.22:8554/live?channel=2&subtype=0", "rtsp://192.168.1.22:8554/live@entrance?channel=2"])("extracts the camera IP without discarding its port, path, or query: %s", (rtsp) => {
    const custom = updateCameraConnection({ ...tapo, cameraBrand: "custom" }, { rtsp });
    expect(custom).toMatchObject({ cameraHost: "192.168.1.22", rtsp });
    expect(validateCameraConnection(custom)).toBeUndefined();
  });

  it.each([
    "http://192.168.1.20/live",
    "rtsp://camera.local/live",
    "rtsp://192.168.1.20:0/live",
    "rtsp://192.168.1.20:99999/live",
    "rtsp://192.168.1.20:/live",
    "rtsp://192.168.1.20/live#fragment",
    "rtsp://admin:secret@192.168.1.20/live",
    "rtsp://192.168.1.20/live path",
    "rtsp://192.168.1.21/live",
  ])("rejects invalid or conflicting custom endpoints: %s", (rtsp) => {
    expect(validateCameraConnection({ ...tapo, cameraBrand: "custom", rtsp })).toBeTruthy();
  });
});
