import { Activity, Info } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../../components/Card";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { TrendFilter } from "../types/dashboard";
import type { LocalHistoricalMetricsPoint, LocalMetricsSummary } from "../../camera/services/ml-service";
import { buildHistoricalTrendChartData, getPeriodPeakReference, hasHistoricalTrendData } from "../utils/trendMetrics";

const trendOptions: TrendFilter[] = ["Today", "Week", "Month"];
const entrySeriesColor = "var(--enterprise-chart-entry)";
const occupancySeriesColor = "var(--enterprise-chart-occupancy)";
const peakReferenceColor = "var(--enterprise-chart-peak)";

type HistoricalTrendChartProps = {
  data: LocalHistoricalMetricsPoint[];
  summary: LocalMetricsSummary | null;
  trendFilter: TrendFilter;
  unavailable?: boolean;
  onTrendFilterChange: (filter: TrendFilter) => void;
};

type TrendTooltipProps = {
  active?: boolean;
  label?: string;
  payload?: ReadonlyArray<{ color?: string; name?: string; value?: number | string }>;
};

export function HistoricalTrendChart({ data, summary, trendFilter, unavailable = false, onTrendFilterChange }: HistoricalTrendChartProps) {
  const chartData = buildHistoricalTrendChartData(data, summary?.entries ?? 0);
  const hasSeriesData = hasHistoricalTrendData(chartData);
  const peakReference = getPeriodPeakReference(data);
  const currentOccupancy = summary?.current_occupancy ?? 0;
  const utilizationRate = peakReference > 0 ? Math.round((currentOccupancy / peakReference) * 100) : 0;

  return (
    <Card className="tanaw-enterprise-chart-panel overflow-hidden rounded-3xl border border-gray-200 p-0 shadow-sm transition-[background-color,border-color,box-shadow] duration-200 hover:shadow-[0_14px_34px_rgba(15,23,42,0.1)] dark:border-(--enterprise-border-soft)">
      <div className="tanaw-trend-header flex flex-wrap items-start justify-between gap-5 border-b border-gray-200/80 px-6 py-5 dark:border-(--enterprise-border-soft)">
        <div className="min-w-0">
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
          <div
            className="tanaw-trend-segmented flex rounded-xl border border-gray-200 bg-gray-100 p-1 dark:border-(--enterprise-border-soft) dark:bg-(--enterprise-panel-bg)"
            aria-label="Historical visitor trend period"
          >
            {trendOptions.map((trend) => (
              <button
                key={trend}
                type="button"
                onClick={() => onTrendFilterChange(trend)}
                aria-pressed={trendFilter === trend}
                className={`min-h-8 rounded-lg px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-offset-2 ${
                  trendFilter === trend
                    ? "bg-white text-[#111827] shadow-sm dark:bg-(--enterprise-card-elevated-bg) dark:text-(--enterprise-text)"
                    : "text-gray-500 hover:text-[#111827] dark:text-(--enterprise-muted-soft) dark:hover:text-(--enterprise-text)"
                }`}
              >
                {trend}
              </button>
            ))}
          </div>
          <ChartLegend />
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {hasSeriesData ? (
          <div className="tanaw-trend-plot h-80 min-h-80 w-full rounded-2xl border border-gray-200/80 bg-gray-50/55 p-3 dark:border-(--enterprise-border-soft) dark:bg-(--enterprise-panel-bg)">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                key={trendFilter}
                accessibilityLayer
                data={chartData}
                margin={{ top: 16, right: 18, left: -10, bottom: 8 }}
                role="img"
                aria-label={`${trendFilter} historical visitor trends for Entry Flow and Live Occupancy`}
              >
                <CartesianGrid strokeDasharray="2 7" vertical={false} stroke="var(--enterprise-chart-grid)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--enterprise-chart-axis)", fontWeight: 600 }} dy={10} minTickGap={22} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--enterprise-chart-axis)", fontWeight: 600 }} width={44} domain={[0, "auto"]} />
                <RechartsTooltip cursor={{ stroke: "var(--enterprise-chart-cursor)", strokeWidth: 1.5, strokeDasharray: "4 4" }} content={<TrendTooltip />} />
                {peakReference > 0 && (
                  <ReferenceLine
                    y={peakReference}
                    stroke={peakReferenceColor}
                    strokeDasharray="5 6"
                    label={{ value: `Peak ${peakReference.toLocaleString()}`, fill: peakReferenceColor, fontSize: 10, fontWeight: 700, position: "insideTopRight" }}
                  />
                )}
                <Line
                  type="linear"
                  dataKey="entry_flow"
                  name="Entry Flow"
                  stroke={entrySeriesColor}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5, stroke: "var(--enterprise-chart-active-stroke)", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="live_occupancy"
                  name="Live Occupancy"
                  stroke={occupancySeriesColor}
                  strokeWidth={3}
                  strokeDasharray="8 4"
                  dot={false}
                  activeDot={{ r: 5, stroke: "var(--enterprise-chart-active-stroke)", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <TrendEmptyState unavailable={unavailable} />
        )}
      </div>
    </Card>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] font-black tracking-wide text-gray-500 uppercase dark:text-slate-300" aria-label="Chart legend">
      <span className="inline-flex items-center gap-2">
        <span className="h-0.75 w-7 rounded-full bg-(--enterprise-chart-entry)" aria-hidden="true" />
        Entry Flow
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="tanaw-trend-legend-dashed w-7" aria-hidden="true" />
        Live Occupancy
      </span>
    </div>
  );
}

function TrendTooltip({ active, label, payload }: TrendTooltipProps) {
  if (!active || !payload?.length) return null;
  const orderedPayload = [...payload].sort((left, right) => (left.name === "Entry Flow" ? -1 : right.name === "Entry Flow" ? 1 : 0));

  return (
    <div className="tanaw-trend-tooltip min-w-52 rounded-2xl border px-4 py-3 text-xs shadow-(--tanaw-shadow-raised)">
      <p className="font-bold text-(--tanaw-text)">{label}</p>
      <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2">
        {orderedPayload.map((item) => (
          <div key={item.name} className="contents">
            <dt className="flex items-center gap-2 text-(--tanaw-secondary-text)">
              <span className={`h-2.5 w-2.5 rounded-full ${item.name === "Entry Flow" ? "bg-(--enterprise-chart-entry)" : "bg-(--enterprise-chart-occupancy)"}`} aria-hidden="true" />
              {item.name}
            </dt>
            <dd className="font-mono font-bold text-(--tanaw-text) tabular-nums">{Number(item.value).toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TrendEmptyState({ unavailable }: { unavailable: boolean }) {
  return (
    <div
      className="tanaw-trend-empty flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50/70 px-6 py-12 text-center dark:border-(--enterprise-border-soft) dark:bg-(--enterprise-panel-bg)"
      role="status"
    >
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/18 dark:bg-emerald-300/10 dark:text-emerald-300">
          <Activity size={22} aria-hidden="true" />
        </span>
        <p className="mt-4 text-sm font-bold text-gray-800 dark:text-slate-100">{unavailable ? "Historical data is temporarily unavailable." : "No visitor activity recorded for this period."}</p>
        <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-slate-400">
          {unavailable ? "TANAW will display visitor trends when the local camera service is ready." : "Choose another period or check again after new camera events are recorded."}
        </p>
      </div>
    </div>
  );
}
