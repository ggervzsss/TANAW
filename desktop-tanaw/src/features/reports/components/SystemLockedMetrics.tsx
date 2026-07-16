import type { DemoBreakdown, DemographicEvidence, Metrics } from "../../../types/enterprise";
import { formatDemographicValue, getExplicitDemographicTotals } from "../utils/demographics";

type SystemLockedMetricsProps = {
  demo: DemoBreakdown;
  demographicEvidence: DemographicEvidence | null;
  metrics: Metrics;
};

export function SystemLockedMetrics({ demo, demographicEvidence, metrics }: SystemLockedMetricsProps) {
  const totals = demographicEvidence ? getExplicitDemographicTotals(demo) : null;

  return (
    <div className="rounded-sm border border-gray-200 bg-gray-50 p-4 shadow-inner">
      <p className="mb-3 text-[10px] font-bold tracking-widest text-gray-500 uppercase">Visitor Summary</p>
      <div className="space-y-3">
        <MetricRow label="Male" value={formatDemographicValue(totals?.male ?? null)} />
        <MetricRow label="Female" value={formatDemographicValue(totals?.female ?? null)} />
        <MetricRow label="Demographic Total" value={formatDemographicValue(totals?.grandTotal ?? null)} />
        <div className="flex items-center justify-between border-t border-gray-200 pt-3 text-sm">
          <span className="font-semibold text-[#065f46]">Camera visitor estimate</span>
          <div className="flex flex-col items-end">
            <span className="font-mono text-lg leading-none font-bold text-[#065f46]">{metrics.unique.toLocaleString()}</span>
          </div>
        </div>
        <p className="text-[10px] leading-relaxed font-semibold text-gray-500">Assisted mode can use this total, while demographic values remain separately labeled as operator estimates.</p>
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
