import { Hourglass, UsersRound } from "lucide-react";
import type { EstablishmentHourly, EstablishmentSummary } from "../../camera/services/ml-service";
import type { SystemTimeFormat } from "../../../utils/date-time";
import { busiestHour } from "../assistant/facts";
import { formatHourRange } from "../assistant/phrases";

type Props = { summary: EstablishmentSummary | null; hourly: EstablishmentHourly | null; timeFormat: SystemTimeFormat };

export function PeakActivity({ summary, hourly, timeFormat }: Props) {
  const busiest = busiestHour(hourly);
  const arrivals = busiest ? `${busiest.arrivals.toLocaleString()} ${busiest.arrivals === 1 ? "arrival" : "arrivals"}` : "";
  return (
    <section className="design-card overview-peak">
      <header>
        <h3>Peak Activity</h3>
        <p>Busiest period and highest count</p>
      </header>
      <div className="peak-content">
        <div>
          <span>
            <Hourglass /> <b>Busiest Hour</b>
          </span>
          <strong>{busiest ? formatHourRange(busiest.hour, timeFormat) : "—"}</strong>
          <small>{busiest ? (busiest.peak == null ? arrivals : `Up to ${busiest.peak.toLocaleString()} inside · ${arrivals}`) : "No hourly activity yet"}</small>
        </div>
        <div>
          <span>
            <UsersRound /> <b>Highest Occupancy</b>
          </span>
          <strong>{summary?.peak_occupancy == null ? "—" : `${summary.peak_occupancy.toLocaleString()} people`}</strong>
          <small>Selected period</small>
        </div>
      </div>
    </section>
  );
}
