import { Activity, Info, User, Users } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import { UnifiedMetricsHeader } from "../../../components/UnifiedMetricsHeader";
import type { LocalMetricsSummary } from "../../camera/services/ml-service";

type DashboardMetricsGridProps = {
  summary: LocalMetricsSummary | null;
};

export function DashboardMetricsGrid({ summary }: DashboardMetricsGridProps) {
  const currentOccupancy = summary?.current_occupancy;
  const entries = summary?.entries;
  const exits = summary?.exits;
  const uniqueCount = summary?.unique_count;

  return (
    <UnifiedMetricsHeader
      ariaLabel="Enterprise analytics summary"
      metrics={[
        {
          id: "occupancy",
          title: "Live Occupancy",
          value: currentOccupancy?.toLocaleString(),
          description: "Currently Inside",
          tone: "success",
          icon: Users,
          showPulse: true,
          badge: (
            <InfoTooltip content="Current number of visitors inside, calculated from entry and exit activity.">
              <Info size={13} className="text-slate-400 transition-colors hover:text-emerald-700 dark:text-slate-500 dark:hover:text-emerald-300" />
            </InfoTooltip>
          ),
        },
        {
          id: "flow",
          title: "Entry & Exit Flow",
          value:
            entries === undefined || exits === undefined ? null : (
              <span className="inline-flex flex-wrap items-baseline gap-2">
                <span>{entries.toLocaleString()}</span>
                <span className="text-lg text-slate-300 dark:text-slate-600">/</span>
                <span className="text-slate-500 dark:text-slate-400">{exits.toLocaleString()}</span>
              </span>
            ),
          valueTitle: entries === undefined || exits === undefined ? undefined : `${entries.toLocaleString()} entries / ${exits.toLocaleString()} exits`,
          description: "Cumulative (In / Out)",
          tone: "neutral",
          icon: Activity,
          badge: (
            <InfoTooltip content="Cumulative visitor movement through configured entry and exit lines.">
              <Info size={13} className="text-slate-400 transition-colors hover:text-emerald-700 dark:text-slate-500 dark:hover:text-emerald-300" />
            </InfoTooltip>
          ),
        },
        {
          id: "unique",
          title: "Unique Entries",
          value: uniqueCount?.toLocaleString(),
          description: "Deduplicated Baseline",
          tone: "success",
          icon: User,
          emphasizeValue: true,
          badge: (
            <InfoTooltip content="Deduplicated visitor count used as the reporting baseline.">
              <Info size={13} className="text-slate-400 transition-colors hover:text-emerald-700 dark:text-slate-500 dark:hover:text-emerald-300" />
            </InfoTooltip>
          ),
        },
      ]}
    />
  );
}
