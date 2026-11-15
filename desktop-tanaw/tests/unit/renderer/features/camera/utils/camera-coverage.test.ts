import { describe, expect, it } from "vitest";
import { defaultCameraCoverage } from "../../../../../../src/features/camera/utils/camera-coverage";

describe("default counting role for a new camera", () => {
  it("lets the first camera contribute to establishment totals right away", () => {
    expect(defaultCameraCoverage("entrance_exit", false)).toMatchObject({ role: "external_boundary", relationship: "independent", related_camera_id: null });
    expect(defaultCameraCoverage("open_space", false)).toMatchObject({ role: "internal_observation", relationship: "independent" });
  });

  it("still asks how a later camera relates to the existing ones", () => {
    expect(defaultCameraCoverage("open_space", true)).toMatchObject({ role: "internal_observation", relationship: "unknown" });
  });
});
