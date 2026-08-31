import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { CAMERA_QUALITY_OPTIONS } from "../utils/rtsp";
import { CameraEditControls } from "./CameraEditControls";

describe("CameraEditControls", () => {
  it("keeps friendly video quality choices inside advanced settings", () => {
    const markup = renderToStaticMarkup(<CameraEditControls editForm={camera} hasExistingPassword onEditFormChange={() => undefined} />);

    expect(markup.indexOf("Advanced Settings")).toBeLessThan(markup.indexOf("Video Quality"));
    expect(markup).toContain("Standard quality (Recommended)");
    expect(CAMERA_QUALITY_OPTIONS).toEqual([
      { label: "Standard quality (Recommended)", value: "stream2" },
      { label: "High quality", value: "stream1" },
    ]);
    expect(markup).toContain("Camera IP Address");
    expect(markup).not.toContain("RTSP Stream");
    expect(markup).not.toContain("Stream URL");
    expect(markup).not.toContain("stream1");
    expect(markup).not.toContain("stream2");
  });
});

const camera: Camera = {
  id: 1,
  name: "Entrance Camera",
  status: "online",
  zone: "Main Entrance",
  cameraHost: "192.168.1.10",
  rtsp: "rtsp://192.168.1.10/stream2",
  rtspStream: "stream2",
  processingProfile: "auto",
  confidence: 0.35,
  username: "camera-user",
  config: {
    tripwire: 50,
    tripwires: {
      entry: { start: { x: 40, y: 0 }, end: { x: 40, y: 100 } },
      exit: { start: { x: 60, y: 0 }, end: { x: 60, y: 100 } },
    },
    roi: { top: 0, left: 0, width: 100, height: 100 },
    reverse: false,
  },
};
