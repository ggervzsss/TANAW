import type { Metrics } from "../../../types/enterprise";

type SystemLockedMetricsProps = {
  metrics: Metrics;
};

export function SystemLockedMetrics({ metrics }: SystemLockedMetricsProps) {
  return (
    <div className="rounded-sm border border-gray-200 bg-gray-50 p-4 shadow-inner">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">Camera Counts</p>
        <span className="text-[10px] font-semibold text-gray-400">Added automatically</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Entries" value={metrics.entries} />
        <MetricCard label="Exits" value={metrics.exits} />
        <MetricCard label="Peak Occupancy" value={metrics.peak} />
        <MetricCard label="Visitor Estimate" value={metrics.unique} emphasized />
      </div>
    </div>
  );
}

function MetricCard({ emphasized = false, label, value }: { emphasized?: boolean; label: string; value: number }) {
  return (
    <div className={`rounded-sm border p-3 ${emphasized ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}>
      <p className="text-[9px] font-bold tracking-wider text-gray-500 uppercase">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${emphasized ? "text-[#065f46]" : "text-[#111827]"}`}>{value.toLocaleString()}</p>
    </div>
  );
}
