import { Link } from "react-router-dom";
import { alertKindLabel, alertMapPath } from "@/features/live-alerts/model/liveAlerts";
import type { LiveAlert } from "@/shared/types";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { BUSY_CATEGORY_LABEL } from "../model/busyEnterprises";
import { formatActivityDate, formatActivityTime } from "../model/recentActivity";
import { activityChipClass, activityColumns, activityRowClass } from "./RecentActivityList";

/**
 * The busy places pinned above the activity records, one soft amber row each, in the records'
 * columns. A row stays while its place is busier than usual; selecting it opens the place on the
 * Dashboard map. They are live alerts, not records, so they never open the details drawer.
 */
export function BusyEnterpriseRows({ alerts, dashboardPath, timeFormat }: { alerts: readonly LiveAlert[]; dashboardPath: string; timeFormat: SystemTimeFormat }) {
  if (alerts.length === 0) return null;
  return (
    <ul aria-label="Busiest enterprises right now" className="tanaw-activity-pinned">
      {alerts.map((alert) => {
        const place = alert.enterpriseName ?? "A place";
        return (
          <li key={alert.id} data-pinned="busy" className="tanaw-activity-item tanaw-activity-item--pinned tanaw-activity-fade">
            <Link to={alertMapPath(alert, dashboardPath)} data-busy-row={alert.id} className={cn(activityColumns, activityRowClass, "tanaw-activity-row--pinned")}>
              <span className="tabular-nums">
                <span className="block font-semibold">{formatActivityDate(alert.startedAt)}</span>
                <span className="block text-(--tanaw-text-secondary)">Since {formatActivityTime(alert.startedAt, timeFormat)}</span>
              </span>
              <span className="min-w-0">
                <span className="tanaw-activity-title block font-semibold wrap-break-word">{alertKindLabel(alert)}</span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className={cn(activityChipClass, "bg-(--ra-chip) text-(--ra-chip-ink)")}>{BUSY_CATEGORY_LABEL}</span>
                  <span className={cn(activityChipClass, "gap-1.5 border border-(--tanaw-warning-line) bg-(--tanaw-warning-bg) text-(--tanaw-warning-text)")}>
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-(--tanaw-warn-ink)" />
                    Still busy
                  </span>
                </span>
              </span>
              <span className="min-w-0">
                <span className="block font-semibold wrap-break-word">{place}</span>
                <span className="block text-[13px] text-(--tanaw-text-secondary)">Enterprise</span>
              </span>
              <span className="line-clamp-3 min-w-0 leading-normal wrap-break-word text-(--tanaw-text-secondary)">
                {alert.summary}
                <span className="sr-only"> Opens {place} on the Dashboard map.</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
