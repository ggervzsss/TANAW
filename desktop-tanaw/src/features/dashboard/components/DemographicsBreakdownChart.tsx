import { useState } from "react";
import { Info, PieChart as PieChartIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card } from "../../../components/Card";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { ReportRecord } from "../../../types/enterprise";
import { demographicCount, getDemographicAllocationStatus, getDemographicTotals } from "../../reports/utils/demographics";
import { emptyDemo, metricsFromReport } from "../utils/reportLedger";

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
  const metrics = report ? metricsFromReport(report) : { entries: 0, exits: 0, peak: 0, unique: 0 };
  const totals = getDemographicTotals(demo);
  const allocation = getDemographicAllocationStatus(demo, metrics.unique);
  const data = slices.map((slice) => ({
    color: slice.color,
    label: slice.label,
    percent: totals.grandTotal > 0 ? Math.round((demographicCount(demo[slice.key]) / totals.grandTotal) * 100) : 0,
    softColor: slice.softColor,
    value: demographicCount(demo[slice.key]),
  }));
  const chartData = data.filter((slice) => slice.value > 0);
  const hasData = chartData.length > 0;
  const activeSlice = activeIndex === null ? null : chartData[activeIndex] ?? null;

  return (
    <Card className="flex flex-col border border-gray-200 p-5 shadow-sm transition-[background-color,border-color,box-shadow] duration-200 hover:shadow-[0_14px_34px_rgba(15,23,42,0.1)] dark:border-(--enterprise-border-soft)">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">Demographics Breakdown</h3>
            <InfoTooltip content="Distribution of reported visitors by residence category and gender.">
              <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {report ? `${report.id} - ${report.period ?? report.date}` : "Male and female distribution by residence category from the selected submitted report."}
          </p>
        </div>
        <PieChartIcon size={18} className="text-[#065f46] dark:text-emerald-300" />
      </div>

      {hasData ? (
        <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative min-h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
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
            {activeSlice ? (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-full rounded-lg border border-emerald-100 bg-slate-900/95 px-3 py-2 text-center text-xs font-bold text-white shadow-[0_14px_32px_rgba(15,23,42,0.24)] dark:border-slate-600"
                style={{ top: "calc(50% - 2.75rem)" }}
              >
                <span className="block max-w-48 wrap-break-word text-emerald-300">{activeSlice.label}</span>
                <span className="mt-0.5 block font-mono">
                  {activeSlice.value.toLocaleString()} · {activeSlice.percent}%
                </span>
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="rounded-full bg-white/85 px-4 py-2 text-center shadow-sm ring-1 ring-emerald-100 dark:bg-slate-900/80 dark:ring-slate-700">
                <p className="text-[10px] font-black tracking-wider text-gray-400 uppercase dark:text-slate-500">Visitors</p>
                <p className="font-mono text-xl font-black text-[#111827] dark:text-slate-100">{totals.grandTotal.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900/55">
              <p className="text-xs font-bold tracking-wider text-gray-400 uppercase dark:text-slate-500">Grand Total</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className="text-2xl font-bold text-[#111827] dark:text-slate-100">{totals.grandTotal.toLocaleString()}</p>
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400">of {metrics.unique.toLocaleString()} unique entries</p>
              </div>
              {allocation.validationMessage && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{allocation.validationMessage}</p>}
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              {data.map((slice) => (
                <div
                  key={slice.label}
                  tabIndex={slice.value > 0 ? 0 : -1}
                  aria-label={`${slice.label}: ${slice.value.toLocaleString()} visitors, ${slice.percent}%`}
                  onFocus={() => {
                    const chartIndex = chartData.findIndex((item) => item.label === slice.label);
                    setActiveIndex(chartIndex >= 0 ? chartIndex : null);
                  }}
                  onBlur={() => setActiveIndex(null)}
                  onMouseEnter={() => {
                    const chartIndex = chartData.findIndex((item) => item.label === slice.label);
                    setActiveIndex(chartIndex >= 0 ? chartIndex : null);
                  }}
                  onMouseLeave={() => setActiveIndex(null)}
                  className="rounded-sm border border-gray-200 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 dark:border-slate-700 dark:bg-slate-900"
                  style={{ boxShadow: `inset 3px 0 0 ${slice.color}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="block h-2 w-9 rounded-full" style={{ background: `linear-gradient(90deg, ${slice.color}, ${slice.softColor})` }} />
                    <span className="font-mono text-[10px] font-black text-gray-400 dark:text-slate-500">{slice.percent}%</span>
                  </div>
                  <p className="mt-2 font-semibold text-gray-600 dark:text-slate-300">{slice.label}</p>
                  <p className="mt-1 font-mono text-base font-bold text-[#111827] dark:text-slate-100">{slice.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-center text-sm font-semibold text-gray-400 dark:border-slate-700 dark:bg-slate-900/55 dark:text-slate-500">
          No demographic data available from submitted reports.
        </div>
      )}
    </Card>
  );
}
