import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SharedContract = {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

const contract = JSON.parse(
  readFileSync(new URL("../../../shared-contracts/operational-v2.openapi.json", import.meta.url), "utf8"),
) as SharedContract;

describe("shared operational contract", () => {
  it("contains the exact report and telemetry write contracts consumed by desktop", () => {
    expect(contract.info.version).toBe("2.0.0");
    expect(contract.paths["/operational/desktop/report-submissions/v2"]?.post).toBeDefined();
    expect(contract.paths["/operational/desktop/telemetry-epochs/v2"]?.post).toBeDefined();
    expect(contract.paths["/operational/desktop/telemetry/v2"]?.post).toBeDefined();
    expect(contract.components.schemas.ReportSubmissionCommand).toBeDefined();
    expect(contract.components.schemas.TelemetryCommand).toBeDefined();
  });
});
