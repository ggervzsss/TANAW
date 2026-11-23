import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOperationalMapEnterprises, visitorInsightsQueryKey } from "@/app/hooks/useOperationalSync";
import { useAuthStore } from "@/app/store/authStore";
import { getVisitorInsights } from "@/shared/services/operationalSync";
import type { MapEnterprise } from "@/shared/types";
import { PortalPageHeader, presetRange, type DateRange } from "@/shared/ui-kit";
import { DashboardMap } from "../components/DashboardMap";
import { MostVisited } from "../components/MostVisited";
import { PeakOccupancy } from "../components/PeakOccupancy";
import { RecentActivity, RecentRequests } from "../components/RecentLists";
import { busyEnterprises } from "../model/busyAlert";
import { placeOptions } from "../model/places";
import "../dashboard.css";

const EMPTY_ENTERPRISES: MapEnterprise[] = [];
const BUSY_REFRESH_MS = 60_000;

/**
 * The Admin Dashboard: the San Pedro map with the busy alert, Most Visited and Peak Occupancy
 * for one shared date range, and the latest activity and requests.
 */
export function AdminDashboardPage() {
  const [today] = useState(() => new Date());
  const [range, setRange] = useState<DateRange>(() => presetRange("month", today));
  const token = useAuthStore((state) => state.token);
  const mapQuery = useOperationalMapEnterprises();
  const enterprises = mapQuery.data ?? EMPTY_ENTERPRISES;
  // The city-wide "today" insights carry the list of enterprises busier than usual right now.
  const busyQuery = useQuery({
    queryKey: [...visitorInsightsQueryKey, { range: "today" }],
    queryFn: () => getVisitorInsights({ range: "today" }),
    enabled: Boolean(token),
    refetchInterval: BUSY_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const monitoredCount = enterprises.filter((enterprise) => enterprise.monitoringStatus !== "Not Configured").length;
  const busy = useMemo(() => busyEnterprises(busyQuery.data?.unusuallyBusy ?? [], new Set()), [busyQuery.data]);
  const places = useMemo(() => placeOptions(enterprises), [enterprises]);

  return (
    <div className="tanaw-dashboard mx-auto w-full max-w-360">
      <PortalPageHeader title="Dashboard" description="Visitor activity and important updates across San Pedro." />
      <div className="tanaw-dashboard__overview">
        <DashboardMap enterprises={enterprises} isEnterpriseError={mapQuery.isError} onRetry={() => void mapQuery.refetch()} busy={busy} monitoredCount={monitoredCount} />
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
