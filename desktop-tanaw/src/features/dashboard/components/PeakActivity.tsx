import { Hourglass, UsersRound } from "lucide-react";
import type { EstablishmentSummary } from "../../camera/services/ml-service";

export function PeakActivity({ summary }: { summary: EstablishmentSummary | null }) {
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
          <strong>{"\u2014"}</strong>
          <small>Hourly data unavailable</small>
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
