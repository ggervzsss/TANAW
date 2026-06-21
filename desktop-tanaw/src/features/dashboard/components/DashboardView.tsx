import { useCallback, useEffect, useState } from "react";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardMetricsGrid } from "./DashboardMetricsGrid";
import { HistoricalTrendChart } from "./HistoricalTrendChart";
import { HourlyDensityChart } from "./HourlyDensityChart";
import type { TrendFilter } from "../types/dashboard";
import { EMPTY_LOCAL_METRICS_HISTORY } from "../../../lib/operationalDefaults";
import { DEFAULT_ML_SERVICE_BASE_URL, getLocalMetricsHistory, getLocalMetricsSummary, getMlServiceStatus } from "../../camera/services/ml-service";
import type { LocalMetricsHistory, LocalMetricsSummary } from "../../camera/services/ml-service";

export function DashboardView() {
  const [trendFilter, setTrendFilter] = useState<TrendFilter>("Week");
  const [summary, setSummary] = useState<LocalMetricsSummary | null>(null);
  const [history, setHistory] = useState<LocalMetricsHistory>(EMPTY_LOCAL_METRICS_HISTORY);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const refreshDashboardMetrics = useCallback(async () => {
    try {
      const status = await getMlServiceStatus();
      const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
      const [nextSummary, nextHistory] = await Promise.all([getLocalMetricsSummary(baseUrl, { includeSubmitted: true }), getLocalMetricsHistory(baseUrl, { includeSubmitted: true })]);

      setSummary(nextSummary);
      setHistory(nextHistory);
      setMetricsError(status.error);
    } catch (error) {
      setMetricsError(error instanceof Error ? error.message : "Unable to load local edge metrics.");
    }
  }, []);

  useEffect(() => {
    void refreshDashboardMetrics();
    const intervalId = window.setInterval(() => void refreshDashboardMetrics(), 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshDashboardMetrics]);

  return (
    <div className="animate-in fade-in space-y-6 font-['Inter'] duration-500">
      <DashboardHeader error={metricsError} summary={summary} />
      <DashboardMetricsGrid summary={summary} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <HistoricalTrendChart data={history.historical[trendFilter]} trendFilter={trendFilter} onTrendFilterChange={setTrendFilter} />
        <HourlyDensityChart data={history.hourly_density} />
      </div>
    </div>
  );
}
