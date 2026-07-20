import { Activity, Info, User, Users } from "lucide-react";
import { Card } from "../../../components/Card";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { LocalMetricsSummary } from "../../camera/services/ml-service";

type DashboardMetricsGridProps = {
  summary: LocalMetricsSummary | null;
};

export function DashboardMetricsGrid({ summary }: DashboardMetricsGridProps) {
  const currentOccupancy = summary?.current_occupancy ?? 0;
  const entries = summary?.entries ?? 0;
  const exits = summary?.exits ?? 0;
  const uniqueCount = summary?.unique_count ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="group relative overflow-hidden border-l-4 border-l-[#065f46] p-5 transition-[background-color,border-color,box-shadow] duration-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.1)]">
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">Live Occupancy</p>
              <InfoTooltip content="Current number of visitors inside, calculated from entry and exit activity.">
                <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
              </InfoTooltip>
            </div>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-[#111827] dark:text-slate-100">{currentOccupancy.toLocaleString()}</h3>
            <p className="mt-1 text-xs font-medium text-gray-500 dark:text-slate-400">Currently Inside</p>
          </div>
          <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-400/12 dark:text-emerald-200 dark:ring-emerald-300/20">
            <Users size={20} />
          </div>
        </div>
      </Card>

      <Card className="border-l-4 border-l-[#111827] p-5 transition-[background-color,border-color,box-shadow] duration-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.1)] dark:border-l-slate-500">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">Entry & Exit Flow</p>
              <InfoTooltip content="Cumulative visitor movement through configured entry and exit lines.">
                <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
              </InfoTooltip>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <h3 className="text-3xl font-bold tracking-tight text-[#111827] dark:text-slate-100">{entries.toLocaleString()}</h3>
              <span className="text-lg font-bold text-gray-300 dark:text-slate-600">/</span>
              <h3 className="text-3xl font-bold tracking-tight text-gray-500 dark:text-slate-400">{exits.toLocaleString()}</h3>
            </div>
            <p className="mt-1 text-xs font-medium text-gray-500 dark:text-slate-400">Cumulative (In / Out)</p>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 text-slate-800 ring-1 ring-slate-200 dark:bg-white/6 dark:text-slate-200 dark:ring-white/10">
            <Activity size={20} />
          </div>
        </div>
      </Card>

      <Card className="border-l-4 border-l-[#065f46] p-5 transition-[background-color,border-color,box-shadow] duration-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.1)]">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">Unique Entries</p>
              <InfoTooltip content="Deduplicated visitor count used as the reporting baseline.">
                <Info size={14} className="text-gray-400 transition-colors hover:text-[#065f46] dark:text-slate-500 dark:hover:text-emerald-300" />
              </InfoTooltip>
            </div>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-[#065f46] dark:text-emerald-300">{uniqueCount.toLocaleString()}</h3>
            <p className="mt-1 text-xs font-medium text-gray-500 dark:text-slate-400">Deduplicated Baseline</p>
          </div>
          <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-400/12 dark:text-emerald-200 dark:ring-emerald-300/20">
            <User size={20} />
          </div>
        </div>
      </Card>
    </div>
  );
}
