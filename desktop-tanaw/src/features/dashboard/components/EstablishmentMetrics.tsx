import { LogIn, LogOut, ScanFace, UsersRound } from "lucide-react";
import type { EstablishmentLive, EstablishmentSummary } from "../../camera/services/ml-service";
import type { TrendFilter } from "../types/dashboard";
import { motion, useReducedMotion } from "motion/react";

type Props = { summary: EstablishmentSummary | null; live: EstablishmentLive | null; filter: TrendFilter; loading: boolean; needsSetup?: boolean };
export function EstablishmentMetrics({ summary, live, filter, loading, needsSetup = false }: Props) {
  const reduceMotion = useReducedMotion();
  const visitorsAvailable = summary && !["not_collected", "configuration_required"].includes(summary.reconciliation_state) && summary.identification_state !== "unavailable";
  const movementAvailable = summary && summary.movement_state !== "unavailable";
  const period = filter === "Today" ? "Today’s" : filter === "Week" ? "7-day" : "30-day";
  const metrics = [
    {
      id: "occupancy",
      title: "Current Occupancy",
      value: live?.occupancy,
      description: live?.state === "partial" ? "partial · people inside" : live?.state === "configuration_required" ? "counting setup required" : "people inside",
      icon: ScanFace,
    },
    {
      id: "entries",
      title: `${period} Entries`,
      value: movementAvailable ? summary.entries : null,
      description: movementAvailable ? "total entries" : "boundary not measured",
      icon: LogIn,
    },
    {
      id: "exits",
      title: `${period} Exits`,
      value: movementAvailable ? summary.exits : null,
      description: movementAvailable ? "total exits" : "boundary not measured",
      icon: LogOut,
    },
    { id: "visitors", title: "Unique Visitors", value: visitorsAvailable ? summary.unique_count : null, description: "estimated", icon: UsersRound },
  ];
  return (
    <section className="overview-metrics" data-unified-metrics-header aria-label="Enterprise analytics summary" aria-busy={loading}>
      {metrics.map(({ id, title, value, description, icon: Icon }) => (
        <article className="overview-metric design-card" key={id} data-metric-segment={id}>
          <span className="overview-metric-icon">
            <Icon aria-hidden="true" />
          </span>
          <div>
            <h3>{title}</h3>
            <motion.strong key={`${loading}-${value}`} initial={{ opacity: reduceMotion ? 1 : 0.6 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}>
              {loading ? <span className="design-skeleton" aria-label="Loading count" /> : value == null ? "—" : value.toLocaleString()}
            </motion.strong>
            <p>{value == null && !loading ? (needsSetup ? "Counting setup required" : "Unavailable") : description}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
