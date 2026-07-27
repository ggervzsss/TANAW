import { describe, expect, it } from "vitest";
import { getPreviewRetryDelayMs, withPreviewRetryVersion } from "./camera-preview-recovery";

describe("camera preview recovery", () => {
  it("backs off retries and caps the delay", () => {
    expect(getPreviewRetryDelayMs(0)).toBe(1000);
    expect(getPreviewRetryDelayMs(2)).toBe(4000);
    expect(getPreviewRetryDelayMs(20)).toBe(10_000);
  });

  it("adds a retry version without dropping existing stream parameters", () => {
    expect(withPreviewRetryVersion("http://127.0.0.1:8765/camera/1/stream?overlay=0&v=3", 2)).toBe(
      "http://127.0.0.1:8765/camera/1/stream?overlay=0&v=3&preview_retry=2",
    );
  });
});
