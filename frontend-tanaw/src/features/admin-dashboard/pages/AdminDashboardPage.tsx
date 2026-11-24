import { useMemo, useState } from "react";
import { useOperationalMapEnterprises } from "@/app/hooks/useOperationalSync";
import type { MapEnterprise } from "@/shared/types";
import { PortalPageHeader, presetRange, type DateRange } from "@/shared/ui-kit";
import { DashboardMap } from "../components/DashboardMap";
import { MostVisited } from "../components/MostVisited";
import { PeakOccupancy } from "../components/PeakOccupancy";
import { RecentActivity, RecentRequests } from "../components/RecentLists";
import { placeOptions } from "../model/places";
import "../dashboard.css";

const EMPTY_ENTERPRISES: MapEnterprise[] = [];
/**
 * The Admin Dashboard: the San Pedro map with coloured pins and live alerts floating over it, Most
 * Visited and Peak Occupancy for one shared date range, and the latest activity and requests.
 */
export function AdminDashboardPage() {
  const [today] = useState(() => new Date());
  const [range, setRange] = useState<DateRange>(() => presetRange("today", today));
  const mapQuery = useOperationalMapEnterprises();
  const enterprises = mapQuery.data ?? EMPTY_ENTERPRISES;
  const monitoredCount = enterprises.filter((enterprise) => enterprise.monitoringStatus !== "Not Configured").length;
  const places = useMemo(() => placeOptions(enterprises), [enterprises]);

  return (
    <div className="tanaw-dashboard mx-auto w-full max-w-360">
      <PortalPageHeader title="Dashboard" description="Visitor activity and important updates across San Pedro." />
      <div className="tanaw-dashboard__overview">
        <DashboardMap enterprises={enterprises} isEnterpriseError={mapQuery.isError} onRetry={() => void mapQuery.refetch()} />
        <div className="tanaw-dashboard__insights">
          <MostVisited range={range} onRangeChange={setRange} today={today} />
          <PeakOccupancy range={range} today={today} places={places} monitoredCount={monitoredCount} />
        </div>
      </div>
      <div className="tanaw-dashboard__recent">
        <RecentActivity />
        <RecentRequests />
      </div>
    </div>
  );
}
