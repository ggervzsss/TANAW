import type { LocalHistoricalMetricsPoint } from "../../camera/services/ml-service";

export function getPeriodPeakReference(data: LocalHistoricalMetricsPoint[]) {
  return data.reduce((peak, point) => Math.max(peak, Math.max(0, point.current_occupancy ?? 0)), 0);
}

export function buildHistoricalTrendChartData(data: LocalHistoricalMetricsPoint[], totalEntries: number) {
  const entrySeries = normalizeEntrySeries(data, totalEntries);
  return data.map((point, index) => ({
    ...point,
    entry_flow: comparableEntryFlow(entrySeries[index] ?? 0, point.current_occupancy ?? 0),
    live_occupancy: Math.max(0, point.current_occupancy ?? 0),
    peak_occupancy: Math.max(0, point.peak_occupancy ?? 0),
  }));
}

export function hasHistoricalTrendData(data: ReturnType<typeof buildHistoricalTrendChartData>) {
  return data.some((point) => point.entry_flow > 0 || point.live_occupancy > 0);
}

function normalizeEntrySeries(data: LocalHistoricalMetricsPoint[], totalEntries: number) {
  const rawEntries = data.map((point) => Math.max(0, point.entries ?? 0));
  const looksCumulative =
    rawEntries.length > 1 &&
    rawEntries.every((value, index) => index === 0 || value >= rawEntries[index - 1]) &&
    totalEntries > 0 &&
    Math.abs(rawEntries[rawEntries.length - 1] - totalEntries) <= Math.max(2, Math.round(totalEntries * 0.02));

  if (!looksCumulative) return rawEntries;

  return rawEntries.map((value, index) => (index === 0 ? value : Math.max(0, value - rawEntries[index - 1])));
}

function comparableEntryFlow(entries: number, liveOccupancy: number) {
  return Math.min(Math.max(0, entries), Math.max(0, liveOccupancy));
}
