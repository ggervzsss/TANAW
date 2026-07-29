import { describe, expect, it } from "vitest";
import type { LocalHistoricalMetricsPoint } from "../../camera/services/ml-service";
import { getPeriodPeakReference } from "../utils/trendMetrics";

describe("getPeriodPeakReference", () => {
  it("derives each peak only from the occupancy values displayed for that period", () => {
    expect(getPeriodPeakReference([point("09:00", 8, 99), point("10:00", 18, 99)])).toBe(18);
    expect(getPeriodPeakReference([point("Fri", 98, 99), point("Sat", 79, 99)])).toBe(98);
    expect(getPeriodPeakReference([point("Jul 14", 99, 99), point("Jul 15", 63, 99)])).toBe(99);
  });

  it("ignores a stored peak that is not represented by the active chart series", () => {
    expect(getPeriodPeakReference([point("Now", 42, 99)])).toBe(42);
  });

  it("returns zero for an empty period instead of retaining the previous period", () => {
    expect(getPeriodPeakReference([])).toBe(0);
  });
});

function point(label: string, currentOccupancy: number, peakOccupancy: number): LocalHistoricalMetricsPoint {
  return {
    label,
    visitors: 0,
    entries: 0,
    exits: 0,
    current_occupancy: currentOccupancy,
    peak_occupancy: peakOccupancy,
  };
}
