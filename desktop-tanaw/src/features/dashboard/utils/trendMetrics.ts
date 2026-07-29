import type { LocalHistoricalMetricsPoint } from "../../camera/services/ml-service";

export function getPeriodPeakReference(data: LocalHistoricalMetricsPoint[]) {
  return data.reduce(
    (peak, point) => Math.max(peak, Math.max(0, point.current_occupancy ?? 0)),
    0,
  );
}
