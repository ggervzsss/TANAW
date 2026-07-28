import { describe, expect, it } from "vitest";
import {
  canRetryPreview,
  getPreviewRetryDelayMs,
  hasRenderablePreviewFrame,
  isCurrentPreviewRequest,
  withPreviewRetryVersion,
} from "./camera-preview-recovery";

describe("camera preview recovery", () => {
  it("recognizes a decoded MJPEG frame without waiting for the request to finish loading", () => {
    expect(hasRenderablePreviewFrame(1280, 720)).toBe(true);
    expect(hasRenderablePreviewFrame(0, 0)).toBe(false);
    expect(hasRenderablePreviewFrame(1280, 0)).toBe(false);
  });

  it("backs off retries and caps the delay", () => {
    expect(getPreviewRetryDelayMs(0)).toBe(1000);
    expect(getPreviewRetryDelayMs(2)).toBe(4000);
    expect(getPreviewRetryDelayMs(20)).toBe(10_000);
  });

  it("bounds automatic preview recovery attempts", () => {
    expect(canRetryPreview(0)).toBe(true);
    expect(canRetryPreview(4)).toBe(true);
    expect(canRetryPreview(5)).toBe(false);
  });

  it("rejects callbacks from an old camera or replaced preview element", () => {
    const currentImage = {};
    expect(
      isCurrentPreviewRequest(
        "camera-2",
        "camera-1",
        currentImage,
        currentImage,
      ),
    ).toBe(false);
    expect(
      isCurrentPreviewRequest("camera-1", "camera-1", currentImage, {}),
    ).toBe(false);
    expect(
      isCurrentPreviewRequest(
        "camera-1",
        "camera-1",
        currentImage,
        currentImage,
      ),
    ).toBe(true);
  });

  it("adds a retry version without dropping existing stream parameters", () => {
    expect(withPreviewRetryVersion("http://127.0.0.1:8765/camera/1/stream?overlay=0&v=3", 2)).toBe(
      "http://127.0.0.1:8765/camera/1/stream?overlay=0&v=3&preview_retry=2",
    );
  });
});
