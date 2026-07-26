import type { LocalMetricsSummary } from "../../camera/services/ml-service";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { formatPhilippineDateTime } from "../../../utils/date-time";

type DashboardHeaderProps = {
  summary: LocalMetricsSummary | null;
};

export function DashboardHeader({ summary }: DashboardHeaderProps) {
  const { timeFormat } = useSystemDisplayPreferences();

  return (
    <div className="flex items-center justify-between border-b border-gray-200 pb-3 dark:border-(--enterprise-border-soft)">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[#111827] dark:text-(--enterprise-text)">Enterprise Analytics</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-(--enterprise-muted)">
          Current visitor counts for this establishment.
          {summary?.last_event_at && (
            <span className="ml-2 font-semibold text-[#065f46] dark:text-emerald-300">
              Last event {formatPhilippineDateTime(summary.last_event_at, timeFormat, { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
