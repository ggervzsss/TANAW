import { Hourglass, UsersRound } from "lucide-react";
import type { EstablishmentSummary } from "../../camera/services/ml-service";

import type { DashboardMockData } from "../data/dashboardMockData";

export function PeakActivity({ summary, mockPeak }: { summary: EstablishmentSummary | null; mockPeak?: DashboardMockData["peak"] }) {
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
          <strong>{mockPeak?.busiestHour ?? "\u2014"}</strong>
          <small>{mockPeak ? mockPeak.caption : "Hourly data unavailable"}</small>
        </div>
        <div>
          <span>
            <UsersRound /> <b>Highest Occupancy</b>
          </span>
          <strong>{(mockPeak?.highestOccupancy ?? summary?.peak_occupancy) == null ? "—" : `${(mockPeak?.highestOccupancy ?? summary?.peak_occupancy)?.toLocaleString()} people`}</strong>
          <small>{mockPeak?.caption ?? "Selected period"}</small>
        </div>
      </div>
    </section>
  );
}
