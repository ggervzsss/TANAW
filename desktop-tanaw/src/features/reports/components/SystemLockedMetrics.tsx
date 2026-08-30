import type { DemoBreakdown, Metrics } from "../../../types/enterprise";
import { getDemographicAllocationStatus } from "../utils/demographics";

type SystemLockedMetricsProps = {
  demo: DemoBreakdown;
  metrics: Metrics;
};

export function SystemLockedMetrics({ demo, metrics }: SystemLockedMetricsProps) {
  const allocation = getDemographicAllocationStatus(demo, metrics.unique);
  const totals = allocation.totals;

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      <p className="mb-3 text-[10px] font-bold tracking-widest text-gray-500 uppercase">Visitor Summary</p>
      <div className="space-y-3">
        <MetricRow label="Male" value={totals.male.toLocaleString()} />
        <MetricRow label="Female" value={totals.female.toLocaleString()} />
        <MetricRow label="Demographic Total" value={totals.grandTotal.toLocaleString()} />
        <div className="flex items-center justify-between rounded-xl border border-emerald-800/12 bg-emerald-50/70 px-3 py-3 text-sm shadow-sm dark:bg-emerald-400/8">
          <span className="font-semibold text-[#065f46]">System Unique Count</span>
          <div className="flex flex-col items-end">
            <span className="font-mono text-lg leading-none font-bold text-[#065f46]">{allocation.cap.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium text-gray-600">{label}</span>
      <span className="min-w-10 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-center font-mono font-bold text-[#111827] shadow-[0_2px_6px_rgba(15,23,42,0.04)]">{value}</span>
    </div>
  );
}
