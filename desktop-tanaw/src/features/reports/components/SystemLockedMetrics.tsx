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
    <div className="rounded-sm border border-gray-200 bg-gray-50 p-4 shadow-inner">
      <p className="mb-3 text-[10px] font-bold tracking-widest text-gray-500 uppercase">Visitor Summary</p>
      <div className="space-y-3">
        <MetricRow label="Male" value={totals.male.toLocaleString()} />
        <MetricRow label="Female" value={totals.female.toLocaleString()} />
        <MetricRow label="Demographic Total" value={totals.grandTotal.toLocaleString()} />
        <div className="flex items-center justify-between border-t border-gray-200 pt-3 text-sm">
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
      <span className="rounded-sm border border-gray-200 bg-white px-2 py-0.5 font-mono font-bold text-[#111827]">{value}</span>
    </div>
  );
}
