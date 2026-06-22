import { TrendingDown, TrendingUp } from "lucide-react";
import type { Metrics } from "../../../types/enterprise";

type SystemLockedMetricsProps = {
  metrics: Metrics;
  prevMetrics: Metrics | null;
  uniqueTrend: number;
};

export function SystemLockedMetrics({ metrics, prevMetrics, uniqueTrend }: SystemLockedMetricsProps) {
  return (
    <div className="rounded-sm border border-gray-200 bg-gray-50 p-4 shadow-inner">
      <p className="mb-3 text-[10px] font-bold tracking-widest text-gray-500 uppercase">System Locked Metrics</p>
      <div className="space-y-3">
        <MetricRow label="Total Entries" value={metrics.entries.toLocaleString()} />
        <MetricRow label="Total Exits" value={metrics.exits.toLocaleString()} />
        <MetricRow label="Peak Occupancy" value={metrics.peak.toLocaleString()} />
        <div className="flex items-center justify-between border-t border-gray-200 pt-3 text-sm">
          <span className="font-semibold text-[#065f46]">Est. Unique Count</span>
          <div className="flex flex-col items-end">
            <span className="font-mono text-lg leading-none font-bold text-[#065f46]">{metrics.unique.toLocaleString()}</span>
            {prevMetrics && (
              <span
                className={`mt-1.5 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-bold shadow-sm ${uniqueTrend >= 0 ? "border border-green-200 bg-green-100 text-green-700" : "border border-red-200 bg-red-100 text-red-700"}`}
              >
                {uniqueTrend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {Math.abs(uniqueTrend)}% vs Prev
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-[9px] tracking-wider text-gray-400 uppercase">* Edge logs data. Non-editable.</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium text-gray-600">{label}</span>
      <span className="rounded-sm border border-gray-200 bg-white px-2 py-0.5 font-mono font-bold text-[#111827]">{value}</span>
    </div>
  );
}
