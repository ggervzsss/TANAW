import { describe, expect, it } from "vitest";
import contractDocument from "../../../../shared-contracts/operational-v2.openapi.json";

type SharedContract = {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

const contract = contractDocument as SharedContract;

describe("shared operational contract", () => {
  it("contains the immutable report and live-map APIs consumed by the portal", () => {
    expect(contract.info.version).toBe("2.0.0");
    expect(contract.paths["/operational/reports/v2"]?.get).toBeDefined();
    expect(contract.paths["/operational/reports/finalizations/v2"]?.post).toBeDefined();
    expect(contract.paths["/operational/sites/v2"]?.get).toBeDefined();
    expect(contract.paths["/maintenance/operations"]?.get).toBeDefined();
    expect(contract.components.schemas.FinalizationAcknowledgement).toBeDefined();
    expect(contract.components.schemas.SiteLiveStateResponse).toBeDefined();
  });
});
