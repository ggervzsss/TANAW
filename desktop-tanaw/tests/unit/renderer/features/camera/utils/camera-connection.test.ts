import { describe, expect, it } from "vitest";
import { defaultStreamAddress, updateCameraConnection, validateCameraConnection, type CameraConnection } from "../../../../../../src/features/camera/utils/camera-connection";

const tapo: CameraConnection = { cameraHost: "192.168.1.20", rtsp: "rtsp://192.168.1.20/stream2" };

describe("camera connection from brand and IP address", () => {
  it("starts each brand with its lighter sub-stream", () => {
    expect(defaultStreamAddress("tapo", "192.168.1.20")).toBe("rtsp://192.168.1.20/stream2");
    expect(defaultStreamAddress("dahua", "192.168.1.20")).toBe("rtsp://192.168.1.20:554/cam/realmonitor?channel=1&subtype=1");
    expect(defaultStreamAddress("tenda", "192.168.1.20")).toBe("rtsp://192.168.1.20:554/ch=1?subtype=1");
    expect(defaultStreamAddress("custom", "192.168.1.20")).toBe("");
  });

  it("rebuilds the address when the IP address changes", () => {
    expect(updateCameraConnection(tapo, { cameraHost: "192.168.1.21" }).rtsp).toBe("rtsp://192.168.1.21/stream2");
    expect(validateCameraConnection(tapo)).toBeUndefined();
  });

  it("keeps a stream address chosen by Test Connection until the brand or IP changes", () => {
    const chosen: CameraConnection = { ...tapo, cameraBrand: "tenda", rtsp: "rtsp://192.168.1.20:8554/profile1" };
    expect(updateCameraConnection(chosen, {}).rtsp).toBe(chosen.rtsp);
    expect(updateCameraConnection(chosen, { cameraHost: "192.168.1.20" }).rtsp).toBe(chosen.rtsp);
    expect(validateCameraConnection(chosen)).toBeUndefined();
    const main: CameraConnection = { ...tapo, rtsp: "rtsp://192.168.1.20/stream1" };
    expect(validateCameraConnection(main)).toBeUndefined();
  });

  it("switches brands per camera", () => {
    const tenda = updateCameraConnection(tapo, { cameraBrand: "tenda" });
    expect(tenda.rtsp).toBe("rtsp://192.168.1.20:554/ch=1?subtype=1");
    expect(updateCameraConnection(tenda, { cameraBrand: "tapo" }).rtsp).toBe(tapo.rtsp);
    const dahua = updateCameraConnection(tenda, { cameraBrand: "dahua" });
    expect(dahua.rtsp).toBe("rtsp://192.168.1.20:554/cam/realmonitor?channel=1&subtype=1");
    expect(validateCameraConnection(dahua)).toBeUndefined();
    expect(updateCameraConnection(dahua, { cameraBrand: "custom" }).rtsp).toBe(dahua.rtsp);
  });

  it.each(["rtsp://192.168.1.22:8554/live?channel=2&subtype=0", "rtsp://192.168.1.22:8554/live@entrance?channel=2"])(
    "extracts the camera IP without discarding its port, path, or query: %s",
    (rtsp) => {
      const custom = updateCameraConnection({ ...tapo, cameraBrand: "custom" }, { rtsp });
      expect(custom).toMatchObject({ cameraHost: "192.168.1.22", rtsp });
      expect(validateCameraConnection(custom)).toBeUndefined();
    },
  );

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
