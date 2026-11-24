import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { SystemLog } from "@/shared/types";
import { Alert, DateRangePicker, Pagination, PortalPageHeader, SearchField, Select, formatRangeText, monthRange, type DateRange } from "@/shared/ui-kit";
import { RecentActivityDrawer } from "../components/RecentActivityDrawer";
import { RecentActivityList } from "../components/RecentActivityList";
import "../components/recentActivity.css";
import { useActivityLogs } from "../hooks/useActivityLogs";
import {
  ACTIVITY_PARAM,
  activityPageOf,
  activitySummaryParts,
  activityTypeLabel,
  activityTypeOptions,
  filterRecentActivity,
  paginateActivity,
  parseActivityType,
  type ActivityTypeFilter,
} from "../model/recentActivity";

const linkButton = "font-semibold text-(--tanaw-accent-ink) underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)";

const PORTAL_COPY = {
  admin: {
    title: "Recent Activity",
    description: "Everything that happened in TANAW, newest first. Select an activity to see all its details.",
    back: { to: routes.admin.dashboard, label: "Dashboard" },
  },
  it: {
    title: "System Activity",
    description: "Everything that happened in TANAW, newest first, with the technical details IT needs.",
    back: undefined,
  },
} as const;

/**
 * Activity: every record, newest first, in six groups. The Admin and IT read the same records;
 * IT's records also carry technical details. Selecting a row opens its details in a drawer.
 */
export function ActivityPage({ portal = "admin" }: { portal?: "admin" | "it" }) {
  const copy = PORTAL_COPY[portal];
  const { timeFormat } = useSystemDisplayPreferences();
  const { logs, isLoading, isError, refetch } = useActivityLogs();
  const [now] = useState(() => new Date());
  const [type, setType] = useState<ActivityTypeFilter>("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange>(() => monthRange(now.getFullYear(), now.getMonth(), now));
  // null until the user pages: the list then opens on the page holding the linked activity.
  const [pageChoice, setPageChoice] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(ACTIVITY_PARAM);

  const activities = useMemo(() => filterRecentActivity(logs, { type, query, range }), [logs, type, query, range]);
  const selectedIndex = selectedId ? activities.findIndex((log) => log.id === selectedId) : -1;
  const selected = selectedId ? (activities[selectedIndex] ?? logs.find((log) => log.id === selectedId) ?? null) : null;
  const paged = paginateActivity(activities, pageChoice ?? activityPageOf(selectedIndex));
  const summary = activitySummaryParts(activities, type, query);
  const rangeText = formatRangeText(range);
  const filtered = type !== "all" || Boolean(query.trim());

  const setSelected = (id: string | null) =>
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) next.set(ACTIVITY_PARAM, id);
        else next.delete(ACTIVITY_PARAM);
        return next;
      },
      { replace: true },
    );

  const closeDrawer = () => {
    const id = selected?.id;
    setSelected(null);
    // Return focus to the row of the activity last shown, which may differ from the one first opened.
    if (id)
      requestAnimationFrame(() => {
        const row = Array.from(document.querySelectorAll<HTMLElement>("[data-activity-row]")).find((element) => element.dataset.activityRow === id);
        row?.focus();
      });
  };

  const moveSelection = (step: number) => {
    const index = selectedIndex + step;
    const next = activities[index];
    if (!next) return;
    setSelected(next.id);
    setPageChoice(activityPageOf(index));
  };

  const changeType = (value: string) => {
    setType(parseActivityType(value));
    setPageChoice(1);
    setSelected(null);
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    setPageChoice(1);
  };
  const changeRange = (value: DateRange) => {
    setRange(value);
    setPageChoice(1);
    setSelected(null);
  };
  const showAll = () => {
    setType("all");
    setQuery("");
    setPageChoice(1);
    setSelected(null);
  };

  const emptyMessage = isLoading
    ? "Loading activity."
    : filtered
      ? `No ${type === "all" ? "activity" : activityTypeLabel(type).toLowerCase()} ${query.trim() ? `matching “${query.trim()}” ` : ""}for ${rangeText}.`
      : `No activity recorded for ${rangeText}.`;

  return (
    <div className="tanaw-recent-activity pb-14">
      <PortalPageHeader back={copy.back} title={copy.title} description={copy.description} />

      <div role="search" aria-label="Filter activity" className="mt-4.5 grid grid-cols-[minmax(0,1fr)_14rem_14rem] items-center gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <SearchField value={query} onChange={changeQuery} placeholder="Search activity, person, or enterprise" className="max-lg:col-span-2 max-sm:col-span-1 [&_input]:h-11" />
        <Select
          ariaLabel="Activity type"
          value={type}
          onChange={changeType}
          options={activityTypeOptions.map((option) => ({ value: option.value, label: option.label, meta: option.meta }))}
          className="[&_.tanaw-select-trigger]:min-h-11"
        />
        <DateRangePicker value={range} onChange={changeRange} variant="field" ariaLabel={`Choose a date range for ${copy.title}`} today={now} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.84375rem] text-(--tanaw-text-secondary)">
        <p role="status" className="tabular-nums">
          <span className="font-bold text-(--tanaw-text)">{summary.label}</span> · {isLoading ? "Loading records" : summary.count} · {rangeText}
        </p>
        {filtered && (
          <button type="button" onClick={showAll} className={linkButton}>
            Show all activity
          </button>
        )}
      </div>

      {isError && (
        <Alert
          tone="danger"
          className="mt-4"
          title={`${copy.title} could not be loaded.`}
          action={
            <button type="button" onClick={() => void refetch()} className={linkButton}>
              Try again
            </button>
          }
        />
      )}

      <section aria-label="Activity records" className="mt-4">
        <RecentActivityList
          rows={paged.rows}
          selectedId={selected?.id ?? null}
          timeFormat={timeFormat}
          onSelect={(log: SystemLog) => setSelected(log.id)}
          empty={
            <p className="border-b border-(--tanaw-border-soft) px-3 py-10 text-center text-sm text-(--tanaw-text-secondary)">
              {emptyMessage}{" "}
              {filtered && !isLoading && (
                <button type="button" onClick={showAll} className={linkButton}>
                  Show all activity
                </button>
              )}
            </p>
          }
        />
        <Pagination page={paged.page} pageCount={paged.pageCount} onChange={setPageChoice} summary={paged.summary} ariaLabel="Activity pages" />
      </section>

      {selected && (
        <RecentActivityDrawer
          log={selected}
          position={selectedIndex}
          total={activities.length}
          portal={portal}
          timeFormat={timeFormat}
          onClose={closeDrawer}
          onPrevious={() => moveSelection(-1)}
          onNext={() => moveSelection(1)}
        />
      )}
    </div>
  );
}
