import { Activity, Info, TrendingUp, User, Users } from "lucide-react";
import { Card } from "../../../components/Card";
import type { LocalMetricsSummary } from "../../camera/services/ml-service";

type DashboardMetricsGridProps = {
  summary: LocalMetricsSummary | null;
};

export function DashboardMetricsGrid({ summary }: DashboardMetricsGridProps) {
  const currentOccupancy = summary?.current_occupancy ?? 0;
  const peakOccupancy = summary?.peak_occupancy ?? 0;
  const entries = summary?.entries ?? 0;
  const exits = summary?.exits ?? 0;
  const uniqueCount = summary?.unique_count ?? 0;
  const utilizationRate = peakOccupancy > 0 ? Math.round((currentOccupancy / peakOccupancy) * 100) : 0;
  const utilizationWidth = `${Math.min(100, Math.max(0, utilizationRate))}%`;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="group relative overflow-hidden border-l-4 border-l-[#065f46] p-5">
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-wider text-gray-500 uppercase">Net Occupancy</p>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-[#111827]">{currentOccupancy.toLocaleString()}</h3>
            <p className="mt-1 text-xs font-medium text-gray-500">Currently Inside</p>
          </div>
          <div className="rounded-sm bg-[#065f46]/10 p-3 text-[#065f46]">
            <Users size={20} />
          </div>
        </div>
        <div className="relative z-10 mt-4 h-1.5 w-full rounded-full bg-gray-100">
          <div className="h-1.5 rounded-full bg-[#065f46] transition-all duration-1000" style={{ width: utilizationWidth }}></div>
        </div>
      </Card>

      <Card className="border-l-4 border-l-[#111827] p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-wider text-gray-500 uppercase">Entry & Exit Flow</p>
            <div className="mt-1 flex items-baseline gap-2">
              <h3 className="text-3xl font-bold tracking-tight text-[#111827]">{entries.toLocaleString()}</h3>
              <span className="text-lg font-bold text-gray-300">/</span>
              <h3 className="text-3xl font-bold tracking-tight text-gray-500">{exits.toLocaleString()}</h3>
            </div>
            <p className="mt-1 text-xs font-medium text-gray-500">Cumulative (In / Out)</p>
          </div>
          <div className="rounded-sm bg-gray-100 p-3 text-[#111827]">
            <Activity size={20} />
          </div>
        </div>
      </Card>

      <Card className="border-l-4 border-l-[#065f46] p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-bold tracking-wider text-gray-500 uppercase">Est. Unique Pax</p>
              <div className="group relative cursor-help">
                <Info size={14} className="text-gray-400 hover:text-[#065f46]" />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-48 -translate-x-1/2 rounded-sm bg-[#111827] p-2 text-[10px] leading-relaxed font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  Deduplicated count filtering out re-entries. Used as the official tourism baseline.
                </div>
              </div>
            </div>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-[#065f46]">{uniqueCount.toLocaleString()}</h3>
            <p className="mt-1 text-xs font-medium text-gray-500">Deduplicated Baseline</p>
          </div>
          <div className="rounded-sm bg-[#065f46]/10 p-3 text-[#065f46]">
            <User size={20} />
          </div>
        </div>
      </Card>

      <Card className="border-l-4 border-l-[#111827] p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold tracking-wider text-gray-500 uppercase">Peak & Utilization</p>
            <h3 className="mt-1 text-3xl font-bold tracking-tight text-[#111827]">{peakOccupancy.toLocaleString()}</h3>
            <p className="mt-1 text-xs font-bold text-[#065f46]">{utilizationRate}% Current vs Peak</p>
          </div>
          <div className="rounded-sm bg-gray-100 p-3 text-[#111827]">
            <TrendingUp size={20} />
          </div>
        </div>
      </Card>
    </div>
  );
}
