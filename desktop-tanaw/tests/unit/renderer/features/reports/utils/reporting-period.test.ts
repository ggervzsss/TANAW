import { describe, expect, it } from "vitest";
import { formatReportingPeriodLabel } from "../../../../../../src/features/reports/utils/reporting-period";

describe("reporting-period display", () => {
  it("preserves the canonical month and year label", () => {
    expect(formatReportingPeriodLabel("June 2026")).toBe("June 2026");
  });

  it("does not adapt noncanonical date-range labels", () => {
    expect(formatReportingPeriodLabel("Jun 1 - Jun 30, 2026")).toBe("Jun 1 - Jun 30, 2026");
  });

  it("preserves unrecognized period labels", () => {
    expect(formatReportingPeriodLabel("Current Period")).toBe("Current Period");
  });
});
