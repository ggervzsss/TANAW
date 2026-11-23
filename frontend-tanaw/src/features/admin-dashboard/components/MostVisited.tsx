import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOperationalReports, visitorInsightsQueryKey } from "@/app/hooks/useOperationalSync";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { getVisitorInsights } from "@/shared/services/operationalSync";
import type { IntakeReport, MapEnterprise, VisitorInsights } from "@/shared/types";
import { DateRangePicker, SegmentedControl, type DateRange } from "@/shared/ui-kit";
import {
  cameraWindowFor,
  collectVisitorEntries,
  dailyUniqueCounts,
  formatCompactCount,
  mostVisitedSubtitle,
  planMostVisited,
  rankVisitors,
  reportedMonths,
  type RankScope,
} from "../model/mostVisited";

const EMPTY_REPORTS: IntakeReport[] = [];
const CAMERA_HISTORY_STALE_MS = 5 * 60_000;

const scopeOptions = [
  { value: "enterprises", label: "Enterprises" },
  { value: "barangays", label: "Barangays" },
  { value: "categories", label: "Categories" },
] as const;

function combineCameraQueries(results: UseQueryResult<VisitorInsights>[]) {
  return {
    series: results.map((result) => result.data?.series),
    loading: results.some((result) => result.isLoading),
    error: results.some((result) => result.isError),
  };
}

type MostVisitedProps = {
  enterprises: readonly MapEnterprise[];
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  today: Date;
};

/** Top five enterprises, barangays or categories by visitors in the chosen range. */
export function MostVisited({ enterprises, range, onRangeChange, today }: MostVisitedProps) {
  const [scope, setScope] = useState<RankScope>("enterprises");
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const reportsQuery = useOperationalReports();
  const reports = reportsQuery.data ?? EMPTY_REPORTS;
  const plan = useMemo(() => planMostVisited(range, today, reportedMonths(reports)), [range, reports, today]);
  const cameraWindow = cameraWindowFor(plan, today);

  // Camera history comes per enterprise: visitor insights has no per-enterprise breakdown for a city.
  const camera = useQueries({
    queries: enterprises.map((enterprise) => {
      const params = { range: cameraWindow ?? "7d", enterpriseId: enterprise.id } as const;
      return {
        queryKey: [...visitorInsightsQueryKey, params],
        queryFn: () => getVisitorInsights(params),
        enabled: Boolean(token) && cameraWindow !== null,
        staleTime: CAMERA_HISTORY_STALE_MS,
      };
    }),
    combine: combineCameraQueries,
  });
  const cameraLoading = cameraWindow !== null && camera.loading;
  const cameraError = cameraWindow !== null && camera.error;

  const rows = useMemo(() => {
    const daily = new Map<string, Map<string, number>>();
    enterprises.forEach((enterprise, index) => {
      const series = camera.series[index];
      if (series) daily.set(enterprise.id, dailyUniqueCounts(series));
    });
    return rankVisitors(collectVisitorEntries(plan, reports, enterprises, daily), scope);
  }, [camera.series, enterprises, plan, reports, scope]);

  const top = rows[0]?.visitors ?? 0;
  const loading = reportsQuery.isLoading || cameraLoading;

  return (
    <section aria-labelledby="most-visited-title" aria-busy={loading} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="most-visited-title" className="font-display m-0 text-[22px] leading-tight font-bold text-(--tanaw-text)">
            Most Visited
          </h2>
          <p className="mt-1 text-sm text-(--tanaw-text-secondary)">{loading ? "Counting visitors…" : mostVisitedSubtitle(scope, rows.length > 0 ? rows.length : 5, plan)}</p>
        </div>
        <DateRangePicker value={range} onChange={onRangeChange} today={today} variant="pill" ariaLabel="Choose a date range for Most Visited and Peak Occupancy" />
      </div>

      <SegmentedControl
        ariaLabel="Rank by"
        options={scopeOptions}
        value={scope}
        onChange={(value) => setScope(value as RankScope)}
        className="mt-4 grid w-full grid-cols-3 gap-0.5 rounded-full bg-(--tanaw-surface-inset) p-0.75 [&>button]:min-h-8.5 [&>button]:justify-center [&>button]:text-[13.5px] [&>button]:font-semibold"
      />

      {reportsQuery.isError || cameraError ? (
        <p role="status" className="mt-4 flex flex-wrap items-center gap-2 text-sm text-(--tanaw-text-secondary)">
          {reportsQuery.isError ? "Monthly reports could not be loaded." : "Some camera counts could not be loaded."}
          <button
            type="button"
            className="tanaw-dashboard-link"
            onClick={() => {
              void reportsQuery.refetch();
              void queryClient.refetchQueries({ queryKey: visitorInsightsQueryKey, type: "active" });
            }}
          >
            Try again
          </button>
        </p>
      ) : null}

      {!loading && rows.length === 0 ? (
        <p className="mt-4 text-sm text-(--tanaw-text-secondary)">No visitors were counted for this range yet.</p>
      ) : (
        <ol className="mt-3 list-none space-y-1 p-0" aria-label={`Most visited ${scope}`}>
          {rows.map((row, index) => {
            const content = (
              <>
                <span className="text-[13px] font-semibold text-(--tanaw-text-muted) tabular-nums">{index + 1}</span>
                <span className="truncate text-sm font-medium text-(--tanaw-text)">{row.label}</span>
                <span className="tanaw-rank-bar" aria-hidden="true">
                  <span style={{ width: `${top > 0 ? Math.max(2, (row.visitors / top) * 100) : 0}%`, background: `var(--dash-r${index + 1})` }} />
                </span>
                <span className="text-right text-sm font-semibold text-(--tanaw-text) tabular-nums" title={`${row.visitors.toLocaleString("en-US")} visitors`}>
                  {formatCompactCount(row.visitors)}
                </span>
              </>
            );
            const label = `${index + 1}. ${row.label}, ${row.visitors.toLocaleString("en-US")} visitors`;
            return (
              <li key={row.key}>
                {row.enterpriseId ? (
                  <Link to={adminEnterpriseDetailsPath(row.enterpriseId)} className="tanaw-dashboard-row tanaw-rank-row" aria-label={`${label}. View details`}>
                    {content}
                  </Link>
                ) : (
                  <div className="tanaw-dashboard-row tanaw-rank-row" aria-label={label} role="group">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
