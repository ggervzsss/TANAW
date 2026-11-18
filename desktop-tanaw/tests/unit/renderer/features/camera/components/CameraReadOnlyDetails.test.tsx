import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../../../../src/types/enterprise";
import { CameraReadOnlyDetails } from "../../../../../../src/features/camera/components/CameraReadOnlyDetails";

describe("CameraReadOnlyDetails", () => {
  it("shows plain camera details without technical stream settings", () => {
    const markup = renderToStaticMarkup(<CameraReadOnlyDetails activeCam={{ ...camera, cameraHost: "192.168.1.10" }} />);

    expect(markup).toContain("Camera Mode");
    expect(markup).toContain("Entry / Exit");
    expect(markup).toContain("192.168.1.10");
    expect(markup).toContain("Counting Area");
    expect(markup).toContain("Counting Direction");
    for (const hidden of ["Stream Protocol", "Camera Address", "Counting role", "High Accuracy", "rtsp://"]) {
      expect(markup).not.toContain(hidden);
    }
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
