import { Activity, Info, User, Users } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import { UnifiedMetricsHeader } from "../../../components/UnifiedMetricsHeader";
import type { LocalMetricsSummary } from "../../camera/services/ml-service";
import type { AreaLive, AreaMetrics } from "../../open-space/types";

type DashboardMetricsGridProps = {
  summary: LocalMetricsSummary | null;
  area?: { live: AreaLive | null; metrics: AreaMetrics | null };
  combinedOccupancy?: number | null;
};

export function DashboardMetricsGrid({ summary, area, combinedOccupancy }: DashboardMetricsGridProps) {
  const combined = combinedOccupancy !== undefined;
  const occupancy = combined ? combinedOccupancy : area ? (area.live?.available ? area.live.presence : null) : summary?.current_occupancy;
  const occupancyMetric = {
    id: "occupancy",
    title: "Live Occupancy",
    value: occupancy?.toLocaleString(),
    description: combined ? (occupancy === null ? "One or more areas unavailable" : "Combined across separate areas") : "Currently Inside",
    tone: "success" as const,
    icon: Users,
    showPulse: occupancy != null,
    badge: (
      <InfoTooltip
        content={
          combined
            ? "Adds the Entrance / Exit occupancy and people currently observed in each separate Open Space zone. An unavailable area makes the combined total unavailable."
            : "Current number of visitors inside, calculated from entry and exit activity."
        }
      >
        <Info size={13} className="text-slate-400 transition-colors hover:text-emerald-700 dark:text-slate-500 dark:hover:text-emerald-300" />
      </InfoTooltip>
    ),
  };
  if (area) {
    return (
      <UnifiedMetricsHeader
        ariaLabel="Enterprise analytics summary"
        metrics={[
          occupancyMetric,
          { id: "peak", title: "Zone Peak Occupancy", value: area.metrics?.peak_presence?.toLocaleString(), description: "Selected zone · highest in period", tone: "neutral", icon: Activity },
          {
            id: "unique",
            title: "Unique Visitors",
            value: area.live?.unique_visitors_available ? area.live.unique_visitors?.toLocaleString() : null,
            description: area.live?.unique_visitors_available ? "Estimated · today in selected zone" : "Visitor identification unavailable",
            tone: "success",
            icon: User,
          },
        ]}
      />
    );
  }
  const entries = summary?.entries;
  const exits = summary?.exits;
  const uniqueCount = summary?.unique_count;

  return (
    <UnifiedMetricsHeader
      ariaLabel="Enterprise analytics summary"
      metrics={[
        occupancyMetric,
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
