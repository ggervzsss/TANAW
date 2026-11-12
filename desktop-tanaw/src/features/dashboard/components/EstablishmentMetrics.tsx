import { Activity, ArrowLeftRight, Users, User } from "lucide-react";
import { UnifiedMetricsHeader } from "../../../components/UnifiedMetricsHeader";
import type { EstablishmentLive, EstablishmentSummary } from "../../camera/services/ml-service";
import type { TrendFilter } from "../types/dashboard";

type Props = { summary: EstablishmentSummary | null; live: EstablishmentLive | null; filter: TrendFilter; loading: boolean };

export function EstablishmentMetrics({ summary, live, filter, loading }: Props) {
  const visitorsAvailable = summary && !["not_collected", "configuration_required"].includes(summary.reconciliation_state) && summary.identification_state !== "unavailable";
  const movementAvailable = summary && summary.movement_state !== "unavailable";
  const period = filter === "Today" ? "Today" : filter === "Week" ? "Past 7 days" : "Past 30 days";
  return (
    <UnifiedMetricsHeader
      layout="grid"
      ariaLabel="Enterprise analytics summary"
      metrics={[
        {
          id: "occupancy",
          title: "Live Occupancy",
          value: live?.occupancy?.toLocaleString(),
          description:
            live?.state === "configuration_required"
              ? "Counting setup required"
              : live?.state === "partial"
                ? "Partial estimate · currently inside"
                : live?.occupancy == null
                  ? "Observations unavailable"
                  : "Currently inside the establishment",
          icon: Users,
          tone: "success",
          isLoading: loading,
          showPulse: live?.occupancy != null,
        },
        {
          id: "visitors",
          title: "Unique Visitors",
          value: visitorsAvailable ? summary.unique_count.toLocaleString() : null,
          description: `${period} · ${filter === "Today" ? "estimated, counted once today" : "daily estimates added together"}`,
          icon: User,
          tone: "success",
          isLoading: loading,
        },
        {
          id: "flow",
          title: "Entry & Exit Flow",
          value: movementAvailable ? `${summary.entries.toLocaleString()} / ${summary.exits.toLocaleString()}` : null,
          description: movementAvailable
            ? `${period} · observed arrivals / departures${summary.movement_state === "partial" ? " · partial coverage" : ""}`
            : `${period} · boundary movement not measured`,
          icon: ArrowLeftRight,
          tone: "neutral",
          isLoading: loading,
        },
        {
          id: "peak",
          title: "Peak Occupancy",
          value: summary?.peak_occupancy?.toLocaleString(),
          description: `${period} · highest simultaneous count`,
          icon: Activity,
          tone: "neutral",
          isLoading: loading,
        },
      ]}
    />
  );
}
