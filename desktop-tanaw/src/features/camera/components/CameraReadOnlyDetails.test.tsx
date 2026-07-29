import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import { CameraReadOnlyDetails } from "./CameraReadOnlyDetails";

describe("CameraReadOnlyDetails", () => {
  it("balances the camera settings grid with the configured stream protocol", () => {
    const markup = renderToStaticMarkup(<CameraReadOnlyDetails activeCam={camera} />);

    expect(markup).toContain("Counting Area");
    expect(markup).toContain("Counting Direction");
    expect(markup).toContain("Counting Mode");
    expect(markup).toContain("Stream Protocol");
    expect(markup).toContain(">RTSP<");
  });
});

const camera: Camera = {
  id: 1,
  name: "Entrance Camera",
  status: "online",
  zone: "Main Entrance",
  rtsp: "rtsp://192.168.1.10/stream2",
  processingProfile: "high_accuracy",
  confidence: 0.35,
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
