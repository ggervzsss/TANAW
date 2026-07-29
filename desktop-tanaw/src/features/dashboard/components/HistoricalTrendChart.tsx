import { Info } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../../components/Card";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { TrendFilter } from "../types/dashboard";
import type { LocalHistoricalMetricsPoint, LocalMetricsSummary } from "../../camera/services/ml-service";
import { getPeriodPeakReference } from "../utils/trendMetrics";

const trendOptions: TrendFilter[] = ["Today", "Week", "Month"];
const entrySeriesColor = "#065f46";
const occupancySeriesColor = "#d97706";
const peakReferenceColor = "#d7b35a";

type HistoricalTrendChartProps = {
  data: LocalHistoricalMetricsPoint[];
  summary: LocalMetricsSummary | null;
  trendFilter: TrendFilter;
  onTrendFilterChange: (filter: TrendFilter) => void;
};

export function HistoricalTrendChart({ data, summary, trendFilter, onTrendFilterChange }: HistoricalTrendChartProps) {
  const entrySeries = normalizeEntrySeries(data, summary?.entries ?? 0);
  const chartData = data.map((point, index) => ({
    ...point,
    entry_flow: comparableEntryFlow(entrySeries[index] ?? 0, point.current_occupancy ?? 0),
    live_occupancy: Math.max(0, point.current_occupancy ?? 0),
    peak_occupancy: Math.max(0, point.peak_occupancy ?? 0),
  }));
  const hasSeriesData = chartData.some((point) => point.entry_flow > 0 || point.live_occupancy > 0);
  const peakReference = getPeriodPeakReference(data);
  const currentOccupancy = summary?.current_occupancy ?? 0;
  const utilizationRate = peakReference > 0 ? Math.round((currentOccupancy / peakReference) * 100) : 0;

  return (
    <Card className="tanaw-enterprise-chart-panel flex flex-col border border-gray-200 p-5 shadow-sm transition-[background-color,border-color,box-shadow] duration-200 hover:shadow-[0_14px_34px_rgba(15,23,42,0.1)] dark:border-(--enterprise-border-soft)">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">Historical Visitor Trends</h3>
            <InfoTooltip content="Shows occupancy and entry movement over the selected period.">
              <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Live occupancy and comparable entry-flow contribution over selected periods</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="tanaw-trend-chip tanaw-trend-chip--peak rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-900 dark:border-amber-300/24 dark:bg-amber-300/12 dark:text-amber-200">
              Peak reference {peakReference.toLocaleString()}
            </span>
            <InfoTooltip content="Shows how current occupancy compares with the highest observed occupancy." focusable={false}>
              <span className="tanaw-trend-chip tanaw-trend-chip--utilization rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-300/12 dark:text-emerald-200">
                Utilization {utilizationRate}%
              </span>
            </InfoTooltip>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-(--enterprise-border-soft) dark:bg-(--enterprise-panel-bg)">
            {trendOptions.map((trend) => (
              <button
                key={trend}
                type="button"
                onClick={() => onTrendFilterChange(trend)}
                aria-pressed={trendFilter === trend}
                className={`rounded-md px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-offset-2 ${
                  trendFilter === trend
                    ? "bg-white text-[#111827] shadow-sm dark:bg-(--enterprise-card-elevated-bg) dark:text-(--enterprise-text)"
                    : "text-gray-500 hover:text-[#111827] dark:text-(--enterprise-muted-soft) dark:hover:text-(--enterprise-text)"
                }`}
              >
                {trend}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-black tracking-wide text-gray-500 uppercase dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: entrySeriesColor }} />
              Entry Flow
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: occupancySeriesColor }} />
              Live Occupancy
            </span>
          </div>
        </div>
      </div>
      <div className="h-96 min-h-96 w-full">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart key={trendFilter} data={chartData} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="dashboardEntryTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={entrySeriesColor} stopOpacity={0.24} />
                  <stop offset="95%" stopColor={entrySeriesColor} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="dashboardOccupancyTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={occupancySeriesColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={occupancySeriesColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-gray-200 dark:text-slate-700" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 600 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 600 }} width={44} />
              <RechartsTooltip
                contentStyle={{
                  borderRadius: "4px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 16px 36px rgb(15 23 42 / 0.16)",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
                formatter={(value, name) => [
                  Number(value).toLocaleString(),
                  name === "live_occupancy" || name === "Live Occupancy" ? "Live Occupancy" : name === "entry_flow" || name === "Entry Flow" ? "Entry Flow" : "Peak Reference",
                ]}
              />
              {peakReference > 0 && (
                <ReferenceLine
                  y={peakReference}
                  stroke={peakReferenceColor}
                  strokeDasharray="5 5"
                  label={{ value: "Peak", fill: peakReferenceColor, fontSize: 11, fontWeight: 700, position: "insideTopRight" }}
                />
              )}
              <Area
                type="monotone"
                dataKey="live_occupancy"
                name="Live Occupancy"
                stroke={occupancySeriesColor}
                strokeWidth={3}
                fill="url(#dashboardOccupancyTrend)"
                fillOpacity={1}
                activeDot={{ r: 5, strokeWidth: 2 }}
                animationDuration={650}
              />
              <Area
                type="monotone"
                dataKey="entry_flow"
                name="Entry Flow"
                stroke={entrySeriesColor}
                strokeWidth={3}
                fill="url(#dashboardEntryTrend)"
                fillOpacity={1}
                activeDot={{ r: 5, strokeWidth: 2 }}
                animationDuration={650}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full min-h-75 items-center justify-center rounded-sm border border-dashed border-gray-200 bg-gray-50 text-xs font-bold tracking-wider text-gray-400 uppercase dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-500">
            {hasSeriesData ? "Preparing chart" : "No trend data available"}
          </div>
        )}
      </div>
    </Card>
  );
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
