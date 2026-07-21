import { describe, expect, it } from "vitest";
import type { BackendSamplePreparationCounts } from "../../sync/services/cloud-sync";
import { formatReportingPeriodRange, shouldPrepareDraftPeriod } from "./reporting-period";

const currentPeriod = "Jul 1 - Jul 31, 2026";
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
    period: "Jun 1 - Jun 30, 2026",
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
    expect(shouldPrepareDraftPeriod("June 2026", currentPeriod, "Jun 1 - Jun 30, 2026", pendingCounts)).toBe(false);
  });
});

describe("reporting-period display", () => {
  it("expands a month and year into the complete reporting range", () => {
    expect(formatReportingPeriodRange("June 2026")).toBe("Jun 1 - Jun 30, 2026");
  });

  it("uses the correct final day for leap-year February", () => {
    expect(formatReportingPeriodRange("February 2024")).toBe("Feb 1 - Feb 29, 2024");
  });

  it("preserves unrecognized period labels", () => {
    expect(formatReportingPeriodRange("Current Period")).toBe("Current Period");
  });
});
