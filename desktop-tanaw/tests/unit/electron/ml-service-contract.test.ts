import { describe, expect, it } from "vitest";
import { hasCompatibleCameraRuntime, hasCompatibleMlHealth } from "../../../electron/ml-service-contract";

describe("ML service compatibility contract", () => {
  it("rejects an incomplete health payload", () => {
    expect(hasCompatibleMlHealth({ status: "ok", running: true })).toBe(false);
  });

  it("rejects a legacy runtime that can emit placeholder video", () => {
    expect(
      hasCompatibleMlHealth({ api_contract_version: 2, tripwire_hot_update: true, max_configured_cameras: 6, max_concurrent_cameras: 2 }),
    ).toBe(false);
  });

  it("requires both the contract version and collection runtime shape", () => {
    expect(
      hasCompatibleMlHealth({
        api_contract_version: 2,
        live_stream_frames_only: true,
        max_configured_cameras: 6,
        max_concurrent_cameras: 6,
        tripwire_hot_update: true,
      }),
    ).toBe(true);
    expect(
      hasCompatibleMlHealth({
        api_contract_version: 3,
        live_stream_frames_only: true,
        max_configured_cameras: 6,
        max_concurrent_cameras: 6,
        tripwire_hot_update: true,
      }),
    ).toBe(false);
    expect(
      hasCompatibleMlHealth({
        api_contract_version: 2,
        live_stream_frames_only: true,
        max_concurrent_cameras: 6,
        tripwire_hot_update: true,
      }),
    ).toBe(false);
    expect(hasCompatibleCameraRuntime({ cameras: [], enterprise_occupancy: 0, pending_camera_ids: [] })).toBe(true);
    expect(hasCompatibleCameraRuntime({ cameras: [], enterprise_occupancy: 0 })).toBe(false);
    expect(hasCompatibleCameraRuntime({ cameras: [] })).toBe(false);
  });
});
