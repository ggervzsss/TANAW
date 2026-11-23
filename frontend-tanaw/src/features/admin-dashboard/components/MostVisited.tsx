import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useVisitorRanking } from "@/app/hooks/useOperationalSync";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { DateRangePicker, SegmentedControl, type DateRange } from "@/shared/ui-kit";
import { formatCompactCount, mostVisitedSubtitle, rankVisitors, type RankScope } from "../model/mostVisited";

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

/** Top five enterprises, barangays or categories by visitors in the chosen range, from one ranking request. */
export function MostVisited({ range, onRangeChange, today }: MostVisitedProps) {
  const [scope, setScope] = useState<RankScope>("enterprises");
  const rankingQuery = useVisitorRanking({ start: range.start, end: range.end });
  const ranking = rankingQuery.data;
  const rows = useMemo(() => (ranking ? rankVisitors(ranking.enterprises, scope) : []), [ranking, scope]);

  const top = rows[0]?.visitors ?? 0;
  const loading = rankingQuery.isLoading;

  return (
    <section aria-labelledby="most-visited-title" aria-busy={loading} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="most-visited-title" className="font-display m-0 text-[22px] leading-tight font-bold text-(--tanaw-text)">
            Most Visited
          </h2>
          <p className="mt-1 text-sm text-(--tanaw-text-secondary)">{loading || !ranking ? "Counting visitors…" : mostVisitedSubtitle(scope, rows.length > 0 ? rows.length : 5, ranking)}</p>
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

      {rankingQuery.isError ? (
        <p role="status" className="mt-4 flex flex-wrap items-center gap-2 text-sm text-(--tanaw-text-secondary)">
          Visitor counts could not be loaded.
          <button type="button" className="tanaw-dashboard-link" onClick={() => void rankingQuery.refetch()}>
            Try again
          </button>
        </p>
      ) : !loading && rows.length === 0 ? (
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
