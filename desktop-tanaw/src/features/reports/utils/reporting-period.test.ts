import { describe, expect, it } from "vitest";
import type { BackendSamplePreparationCounts } from "../../sync/services/cloud-sync";
import { formatReportingPeriodLabel, shouldPrepareDraftPeriod } from "./reporting-period";

const currentPeriod = "July 2026";
const pendingCounts: BackendSamplePreparationCounts[] = [
  {
    entries: 712,
    exits: 644,
    peakOccupancy: 81,
    period: currentPeriod,
    reportId: "SAMPLE-REP-260701",
    uniqueCount: 659,
  },
  {
    entries: 519,
    exits: 461,
    peakOccupancy: 64,
    period: "June 2026",
    reportId: "SAMPLE-REP-260601",
    uniqueCount: 476,
  },
];

describe("ReportsView reporting-period selection", () => {
  it("never prepares the current reporting period as a second local count package", () => {
    expect(shouldPrepareDraftPeriod(currentPeriod, currentPeriod, "June 2026", pendingCounts)).toBe(false);
  });

  it("still prepares a pending historical period when selected", () => {
    expect(shouldPrepareDraftPeriod("June 2026", currentPeriod, currentPeriod, pendingCounts)).toBe(true);
  });

  it("does not prepare a pending period that is already loaded locally", () => {
    expect(shouldPrepareDraftPeriod("June 2026", currentPeriod, "June 2026", pendingCounts)).toBe(false);
  });
});

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
