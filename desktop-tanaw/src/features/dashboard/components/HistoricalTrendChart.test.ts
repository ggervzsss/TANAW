import { describe, expect, it } from "vitest";
import type { LocalHistoricalMetricsPoint } from "../../camera/services/ml-service";
import { buildHistoricalTrendChartData, getPeriodPeakReference, hasHistoricalTrendData } from "../utils/trendMetrics";

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

describe("historical trend chart data", () => {
  it("keeps zero-only periods in an intentional empty state", () => {
    const chartData = buildHistoricalTrendChartData([point("09:00", 0, 0), point("10:00", 0, 0)], 0);

    expect(hasHistoricalTrendData(chartData)).toBe(false);
    expect(chartData.map(({ entry_flow, live_occupancy }) => ({ entry_flow, live_occupancy }))).toEqual([
      { entry_flow: 0, live_occupancy: 0 },
      { entry_flow: 0, live_occupancy: 0 },
    ]);
  });

  it("preserves populated values and converts cumulative entries without interpolation", () => {
    const source = [pointWithEntries("09:00", 12, 12), pointWithEntries("10:00", 18, 20), pointWithEntries("11:00", 15, 32)];
    const chartData = buildHistoricalTrendChartData(source, 32);

    expect(hasHistoricalTrendData(chartData)).toBe(true);
    expect(chartData.map(({ label, entry_flow, live_occupancy }) => ({ label, entry_flow, live_occupancy }))).toEqual([
      { label: "09:00", entry_flow: 12, live_occupancy: 12 },
      { label: "10:00", entry_flow: 8, live_occupancy: 18 },
      { label: "11:00", entry_flow: 12, live_occupancy: 15 },
    ]);
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

function pointWithEntries(label: string, currentOccupancy: number, entries: number): LocalHistoricalMetricsPoint {
  return {
    ...point(label, currentOccupancy, currentOccupancy),
    entries,
  };
}
