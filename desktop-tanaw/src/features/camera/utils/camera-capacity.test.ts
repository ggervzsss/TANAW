import { describe, expect, it } from "vitest";
import {
  cameraConfigurationLimitMessage,
  DEFAULT_ENTERPRISE_CAMERA_LIMIT,
  hasReachedCameraConfigurationLimit,
} from "./camera-capacity";

describe("enterprise camera configuration capacity", () => {
  it("allows cameras one through six and rejects a seventh", () => {
    expect(DEFAULT_ENTERPRISE_CAMERA_LIMIT).toBe(6);
    expect(hasReachedCameraConfigurationLimit(5)).toBe(false);
    expect(hasReachedCameraConfigurationLimit(6)).toBe(true);
    expect(cameraConfigurationLimitMessage()).toBe(
      "This Enterprise account can register up to 6 cameras.",
    );
  });
});
