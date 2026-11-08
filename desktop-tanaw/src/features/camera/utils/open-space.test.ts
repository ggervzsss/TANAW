import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { validateOpenSpace, formatDwell } from "./open-space";
import { OpenSpaceOverlay } from "../components/OpenSpaceOverlay";
import { CameraEditControls } from "../components/CameraEditControls";
import { getCameraSaveRuntimeAction } from "./camera-update";
import type { Camera, OpenSpaceSettings } from "../../../types/enterprise";

const zone: OpenSpaceSettings = {
  zone_id: "main",
  zone_name: "Seats",
  polygon: [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ],
};
describe("open-space geometry and measurement presentation", () => {
  it("validates simple polygons and rejects self-intersections, duplicate vertices, and nonfinite input", () => {
    expect(validateOpenSpace(zone)).toBeNull();
    expect(validateOpenSpace({ ...zone, polygon: zone.polygon.slice(0, 2) })).not.toBeNull();
    expect(validateOpenSpace({ ...zone, polygon: [zone.polygon[0], zone.polygon[2], zone.polygon[1], zone.polygon[3]] })).not.toBeNull();
    expect(validateOpenSpace({ ...zone, polygon: [...zone.polygon, zone.polygon[0]] })).not.toBeNull();
    expect(validateOpenSpace({ ...zone, polygon: [{ x: NaN, y: 0 }, ...zone.polygon.slice(1)] })).not.toBeNull();
  });
  it("keeps unknown dwell different from zero", () => {
    expect(formatDwell(null)).toBe("—");
    expect(formatDwell(0)).toBe("0s");
    expect(formatDwell(125000)).toBe("2m 5s");
  });
  it("shows setup guidance in camera settings without fabricating a default zone", () => {
    const camera: Camera = {
      id: 1,
      name: "Plaza camera",
      zone: "Plaza",
      status: "stopped",
      cameraHost: "192.168.1.10",
      rtsp: "rtsp://192.168.1.10/stream2",
      processingProfile: "auto",
      confidence: 0.35,
      analysisMode: "open_space",
      openSpace: null,
      config: {
        tripwire: 50,
        tripwires: {
          entry: { start: { x: 30, y: 0 }, end: { x: 30, y: 100 } },
          exit: { start: { x: 70, y: 0 }, end: { x: 70, y: 100 } },
        },
        roi: { top: 0, left: 0, width: 100, height: 100 },
        reverse: false,
      },
    };
    const settings = renderToStaticMarkup(createElement(CameraEditControls, { editForm: camera, hasExistingPassword: true, onEditFormChange: () => {} }));
    const html = renderToStaticMarkup(createElement(OpenSpaceOverlay, { value: null, editable: true, onChange: () => {} }));
    expect(settings).toMatch(/start the preview.*draw.*on the image/i);
    expect(settings).toContain("Monitored Area Name");
    expect(html).toContain('points=""');
  });
  it("restarts a running camera when its zone changes rather than hot-updating tripwires", () => {
    const camera = { analysisMode: "open_space", openSpace: zone, config: { roi: {} }, processingProfile: "auto" } as Camera;
    expect(getCameraSaveRuntimeAction(camera, { ...camera, analysisMode: "open_space", openSpace: { ...zone, zone_name: "Plaza" } }, { isRunning: true })).toBe("restart");
    expect(getCameraSaveRuntimeAction(camera, camera, { isRunning: true })).toBe("none");
  });
});
