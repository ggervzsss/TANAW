import type { LocalMetricsSummary } from "../../camera/services/ml-service";

type DashboardHeaderProps = {
  error: string | null;
  summary: LocalMetricsSummary | null;
};

export function DashboardHeader({ error, summary }: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 pb-3 dark:border-(--enterprise-border-soft)">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[#111827] dark:text-(--enterprise-text)">Enterprise Analytics</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-(--enterprise-muted)">
          Real-time edge metrics restricted to this establishment.
          {summary?.last_event_at && <span className="ml-2 font-semibold text-[#065f46] dark:text-emerald-300">Last event {formatMetricTime(summary.last_event_at)}</span>}
        </p>
        {error && <p className="mt-1 text-xs font-semibold text-red-600">Local metrics unavailable: {error}</p>}
      </div>
    </div>
  );
}

function formatMetricTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
  });
}
