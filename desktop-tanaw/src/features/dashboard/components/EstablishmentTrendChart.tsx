import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../../components/Card";
import type { EstablishmentSummary } from "../../camera/services/ml-service";
import type { TrendFilter } from "../types/dashboard";
import { establishmentTrend } from "../utils/establishment";

type Props = { summary: EstablishmentSummary | null; range: { start: string; end: string }; filter: TrendFilter; onFilterChange: (filter: TrendFilter) => void; unavailable: boolean };

export function EstablishmentTrendChart({ summary, range, filter, onFilterChange, unavailable }: Props) {
  const data = establishmentTrend(summary, range);
  const hasData = data.some((point) => point.visitors !== null || point.occupancy !== null);
  const observedZero = hasData && data.every((point) => (point.visitors === null || point.visitors === 0) && (point.occupancy === null || point.occupancy === 0));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Establishment history</h3>
          <p className="mt-1 max-w-xl text-xs text-slate-600 dark:text-slate-300">
            Both camera modes use the same tally. Each day's visitor estimate counts recognized people once across cameras; gaps remain unavailable.
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-1 dark:border-slate-700" aria-label="Historical visitor trend period">
          {(["Today", "Week", "Month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => onFilterChange(value)}
              className={`rounded-md px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${filter === value ? "bg-emerald-800 text-white dark:bg-emerald-700" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
            >
              {value === "Today" ? "Today" : value === "Week" ? "7 days" : "30 days"}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5">
        {observedZero && (
          <p role="status" className="mb-4 text-xs text-slate-600 dark:text-slate-300">
            Available observations recorded no visitor activity. Gaps remain unavailable.
          </p>
        )}
        {hasData ? (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} accessibilityLayer role="img" aria-label={`${filter} establishment visitor and peak occupancy history`} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="2 7" vertical={false} stroke="var(--enterprise-chart-grid)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--enterprise-chart-axis)" }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--enterprise-chart-axis)" }} />
                <Tooltip />
                <Legend />
                <Line
                  type="linear"
                  dataKey="visitors"
                  name="Estimated daily visitors"
                  stroke="var(--enterprise-chart-entry)"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="occupancy"
                  name="Peak occupancy"
                  stroke="var(--enterprise-chart-occupancy)"
                  strokeWidth={3}
                  strokeDasharray="7 4"
                  dot={{ r: 3 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div
            role="status"
            className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"
          >
            {unavailable
              ? "Establishment history is unavailable. Check the local camera service."
              : "No observations have been collected for this period. Configure and start the cameras to record activity."}
          </div>
        )}
      </div>
    </Card>
  );
}
