import { useState } from "react";
import { Info, PieChart as PieChartIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { Card } from "../../../components/Card";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { ReportRecord } from "../../../types/enterprise";
import { formatDemographicValue, getDemographicEvidenceStatus, getDemographicTotals, parseDemographicCount } from "../../reports/utils/demographics";
import { emptyDemo } from "../utils/reportLedger";

type DemographicsBreakdownChartProps = {
  report: ReportRecord | null;
};

const slices = [
  { key: "thisProvMale", label: "This Province Male", color: "#047857", softColor: "#d1fae5" },
  { key: "thisProvFemale", label: "This Province Female", color: "#34d399", softColor: "#ecfdf5" },
  { key: "otherProvMale", label: "Other Province Male", color: "#1d4ed8", softColor: "#dbeafe" },
  { key: "otherProvFemale", label: "Other Province Female", color: "#38bdf8", softColor: "#e0f2fe" },
  { key: "foreignMale", label: "Foreign Male", color: "#b45309", softColor: "#ffedd5" },
  { key: "foreignFemale", label: "Foreign Female", color: "#f59e0b", softColor: "#fef3c7" },
] as const;

export function DemographicsBreakdownChart({ report }: DemographicsBreakdownChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const demo = report?.demo ?? emptyDemo();
  const evidenceStatus = getDemographicEvidenceStatus(demo);
  const hasTrustedEvidence = Boolean(report?.demographicEvidence);
  const totals = getDemographicTotals(demo);
  const canShowDistribution = hasTrustedEvidence && !evidenceStatus.hasMissingValue && !evidenceStatus.validationMessage && totals.grandTotal > 0;
  const data = slices.map((slice) => {
    const explicitValue = hasTrustedEvidence ? parseDemographicCount(demo[slice.key]) : null;
    return {
      color: slice.color,
      label: slice.label,
      percent: canShowDistribution && explicitValue !== null ? Math.round((explicitValue / totals.grandTotal) * 100) : null,
      softColor: slice.softColor,
      value: explicitValue,
    };
  });
  const chartData = data.filter((slice): slice is typeof slice & { percent: number; value: number } => slice.value !== null && slice.percent !== null && slice.value > 0);
  const hasAnyExplicitFact = data.some((slice) => slice.value !== null);

  return (
    <Card className="flex flex-col border border-gray-200 p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.1)] dark:border-slate-700 dark:hover:shadow-[0_18px_44px_rgba(0,0,0,0.35)]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">Demographics Breakdown</h3>
            <InfoTooltip content="Operator-provided demographic facts. Percentages are shown only when every category has explicit evidence.">
              <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{report ? `${report.id} - ${report.period ?? report.date}` : "No submitted report is selected."}</p>
        </div>
        <PieChartIcon size={18} className="text-[#065f46] dark:text-emerald-300" />
      </div>

      {canShowDistribution ? (
        <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative min-h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <RechartsTooltip
                  formatter={(value, name) => [Number(value).toLocaleString(), name]}
                  contentStyle={{
                    border: "1px solid #d1fae5",
                    borderRadius: "8px",
                    boxShadow: "0 16px 36px rgb(15 23 42 / 0.14)",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                />
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="56%"
                  outerRadius="86%"
                  paddingAngle={3}
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth={3}
                  animationBegin={100}
                  animationDuration={820}
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  {chartData.map((slice, index) => (
                    <Cell
                      key={slice.label}
                      fill={slice.color}
                      opacity={activeIndex === null || activeIndex === index ? 1 : 0.62}
                      strokeWidth={activeIndex === index ? 5 : 3}
                      style={{ filter: activeIndex === index ? "drop-shadow(0 10px 14px rgb(15 23 42 / 0.18))" : "none", outline: "none" }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-white/85 px-4 py-2 text-center shadow-sm ring-1 ring-emerald-100 dark:bg-slate-900/80 dark:ring-slate-700">
                <p className="text-[10px] font-black tracking-wider text-gray-400 uppercase dark:text-slate-500">Operator-fact total</p>
                <p className="font-mono text-xl font-black text-[#111827] dark:text-slate-100">{totals.grandTotal.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <FactGrid data={data} showPercentages />
        </div>
      ) : (
        <div className="flex min-h-64 flex-1 flex-col justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 p-5 dark:border-slate-700 dark:bg-slate-900/55">
          <p className="text-center text-sm font-semibold text-gray-500 dark:text-slate-400">
            {hasAnyExplicitFact
              ? "Partial operator facts are shown below. Percentage distribution is Not provided because one or more categories are unknown."
              : "No demographic facts are available from the submitted report."}
          </p>
          <FactGrid data={data} showPercentages={false} />
        </div>
      )}
    </Card>
  );
}

type FactGridProps = {
  data: Array<{
    color: string;
    label: string;
    percent: number | null;
    softColor: string;
    value: number | null;
  }>;
  showPercentages: boolean;
};

function FactGrid({ data, showPercentages }: FactGridProps) {
  return (
    <div className="grid grid-cols-1 gap-2 self-center text-xs sm:grid-cols-2">
      {data.map((slice) => (
        <div key={slice.label} className="rounded-sm border border-gray-200 bg-white p-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-900" style={{ boxShadow: `inset 3px 0 0 ${slice.color}` }}>
          <div className="flex items-center justify-between gap-2">
            <span className="block h-2 w-9 rounded-full" style={{ background: `linear-gradient(90deg, ${slice.color}, ${slice.softColor})` }} />
            {showPercentages && slice.percent !== null && <span className="font-mono text-[10px] font-black text-gray-400 dark:text-slate-500">{slice.percent}%</span>}
          </div>
          <p className="mt-2 font-semibold text-gray-600 dark:text-slate-300">{slice.label}</p>
          <p className="mt-1 font-mono text-base font-bold text-[#111827] dark:text-slate-100">{formatDemographicValue(slice.value)}</p>
        </div>
      ))}
    </div>
  );
}
