import { describe, expect, it } from "vitest";
import { hasCompatibleCameraRuntime, hasCompatibleMlHealth } from "./ml-service-contract";

describe("ML service compatibility contract", () => {
  it("rejects the legacy health payload that caused the runtime 404", () => {
    expect(hasCompatibleMlHealth({ status: "ok", running: true })).toBe(false);
  });

  it("requires both the contract version and collection runtime shape", () => {
    expect(hasCompatibleMlHealth({ api_contract_version: 4 })).toBe(true);
    expect(hasCompatibleCameraRuntime({ cameras: [], enterprise_occupancy: 0 })).toBe(true);
    expect(hasCompatibleCameraRuntime({ cameras: [] })).toBe(false);
  });
});
