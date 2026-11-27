import { ChartBarDecreasing } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useVisitorRanking } from "@/app/hooks/useOperationalSync";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { DateRangePicker, SegmentedControl, Skeleton, type DateRange } from "@/shared/ui-kit";
import { formatCompactCount, mostVisitedSubtitle, rankVisitors, readVisitorRanking, type RankScope } from "../model/mostVisited";

const scopeOptions = [
  { value: "enterprises", label: "Enterprises" },
  { value: "barangays", label: "Barangays" },
  { value: "categories", label: "Categories" },
] as const;

type MostVisitedProps = {
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  today: Date;
};

/** Five rank rows in the shape of the real ones while the ranking loads. */
function RankSkeleton() {
  return (
    <div aria-hidden="true" className="mt-3 space-y-1">
      {[72, 60, 48, 38, 30].map((width, index) => (
        <div key={width} className="tanaw-rank-row">
          <Skeleton className="h-3.5 w-3" />
          <Skeleton className="h-3.5" />
          <span className="block" style={{ width: `${width}%` }}>
            <Skeleton shape="pill" className="h-2.5 w-full" />
          </span>
          <Skeleton className={index === 0 ? "ml-auto h-3.5 w-10" : "ml-auto h-3.5 w-8"} />
        </div>
      ))}
    </div>
  );
}

/** Top five enterprises, barangays or categories by visitors in the chosen range, from one ranking request. */
export function MostVisited({ range, onRangeChange, today }: MostVisitedProps) {
  const [scope, setScope] = useState<RankScope>("enterprises");
  const rankingQuery = useVisitorRanking({ start: range.start, end: range.end });
  const ranking = useMemo(() => readVisitorRanking(rankingQuery.data), [rankingQuery.data]);
  const rows = useMemo(() => (ranking ? rankVisitors(ranking.enterprises, scope) : []), [ranking, scope]);

  const top = rows[0]?.visitors ?? 0;
  const loading = rankingQuery.isLoading;

  return (
    <section aria-labelledby="most-visited-title" aria-busy={loading} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="most-visited-title" className="tanaw-dashboard-heading">
            Most Visited
          </h2>
          <p className="tanaw-dashboard-caption">{loading || !ranking ? "Counting visitors…" : mostVisitedSubtitle(scope, rows.length > 0 ? rows.length : 5, ranking)}</p>
        </div>
        <DateRangePicker value={range} onChange={onRangeChange} today={today} variant="pill" ariaLabel="Choose a date range for Most Visited and Peak Occupancy" />
      </div>

      <SegmentedControl ariaLabel="Rank by" options={scopeOptions} value={scope} onChange={(value) => setScope(value as RankScope)} className="mt-4 grid w-full grid-cols-3 [&>button]:justify-center" />

      {rankingQuery.isError ? (
        <p role="status" className="mt-4 flex flex-wrap items-center gap-2 text-sm text-(--tanaw-text-secondary)">
          Visitor counts could not be loaded.
          <button type="button" className="tanaw-dashboard-link" onClick={() => void rankingQuery.refetch()}>
            Try again
          </button>
        </p>
      ) : loading ? (
        <RankSkeleton />
      ) : rows.length === 0 ? (
        // Holds the ranking's own height, so Peak Occupancy below does not leave a gap in the column.
        <div className="tanaw-dashboard-fade tanaw-dashboard-empty mt-3">
          <span aria-hidden="true" className="tanaw-dashboard-empty__icon">
            <ChartBarDecreasing size={18} />
          </span>
          <p className="m-0 text-sm text-(--tanaw-text-secondary)">No visitors were counted for this range yet.</p>
        </div>
      ) : (
        <ol key={scope} className="tanaw-dashboard-fade mt-3 list-none space-y-1 p-0" aria-label={`Most visited ${scope}`}>
          {rows.map((row, index) => {
            const content = (
              <>
                <span className="text-[13px] font-semibold text-(--tanaw-text-muted) tabular-nums">{index + 1}</span>
                <span className="tanaw-rank-label truncate text-sm font-medium text-(--tanaw-text)">{row.label}</span>
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
