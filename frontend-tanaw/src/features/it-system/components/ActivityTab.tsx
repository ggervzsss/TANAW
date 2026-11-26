import { ChevronDown, ScrollText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, cn, EmptyState, SegmentedControl, Skeleton } from "@/shared/ui-kit";
import { formatPhilippineTime, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";
import {
  activityIdFields,
  activityOriginFields,
  filterSystemActivity,
  parseSystemActivityFilter,
  SYSTEM_ACTIVITY_PAGE_SIZE,
  SYSTEM_ACTIVITY_TYPE_LABELS,
  systemActivityFilterOptions,
  systemActivityLinks,
  systemActivityRow,
  visibleActivityCount,
  type SystemActivityFilter,
  type SystemActivityLog,
  type SystemActivityRow,
  type SystemActivityType,
  type TechnicalField,
} from "../model";

const TYPE_TEXT: Record<SystemActivityType, string> = {
  security: "text-(--tanaw-warning-text)",
  requests: "text-(--tanaw-accent-ink)",
  accounts: "text-(--tanaw-text-secondary)",
  enterprises: "text-(--tanaw-text-secondary)",
  system: "text-(--tanaw-text-secondary)",
};

const ROW_GRID = "grid grid-cols-[9rem_minmax(0,1fr)_12rem_10rem_1.25rem] gap-4 max-lg:grid-cols-[minmax(0,1fr)_1.25rem] max-lg:gap-x-3 max-lg:gap-y-1";
const linkButton = "font-semibold text-(--tanaw-accent-ink) underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)";

type ActivityTabProps = {
  logs: readonly SystemActivityLog[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  now: Date;
  dateFormat: SystemDateFormat;
  timeFormat: SystemTimeFormat;
};

/** Every activity record, newest first, filtered by type. A row opens to show its technical detail. */
export function ActivityTab({ logs, isLoading, isError, onRetry, expandedId, onExpand, now, dateFormat, timeFormat }: ActivityTabProps) {
  const [filter, setFilter] = useState<SystemActivityFilter>("all");
  const [pages, setPages] = useState(1);
  const filtered = useMemo(() => filterSystemActivity(logs, filter), [logs, filter]);
  const expandedIndex = expandedId ? filtered.findIndex((log) => log.id === expandedId) : -1;
  const shown = visibleActivityCount(filtered.length, pages, expandedIndex);
  const rows = useMemo(() => filtered.slice(0, shown).map((log) => systemActivityRow(log, now, dateFormat)), [filtered, shown, now, dateFormat]);
  const remaining = filtered.length - shown;

  // A linked activity (?activity=<id>) scrolls into view once its row exists.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!expandedId || scrolledTo.current === expandedId || expandedIndex < 0) return;
    scrolledTo.current = expandedId;
    const row = document.querySelector<HTMLElement>(`[data-activity-row="${CSS.escape(expandedId)}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [expandedId, expandedIndex]);

  const changeFilter = (value: string) => {
    setFilter(parseSystemActivityFilter(value));
    setPages(1);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <SegmentedControl ariaLabel="Activity type" options={systemActivityFilterOptions} value={filter} onChange={changeFilter} />
        <p className="text-[0.84375rem] text-(--tanaw-text-secondary)">Newest first. Entries never change. Select one to see the technical detail.</p>
      </div>

      {isError && (
        <Alert
          tone="danger"
          className="mt-4"
          title="Activity could not be loaded."
          action={
            <button type="button" onClick={onRetry} className={linkButton}>
              Try again
            </button>
          }
        />
      )}

      <div className="mt-3.5 border-t border-(--tanaw-border-soft)">
        <div
          aria-hidden="true"
          className={cn(ROW_GRID, "tracking-label border-b border-(--tanaw-border-soft) px-3 py-2.5 text-[0.6875rem] font-bold text-(--tanaw-text-secondary) uppercase max-lg:hidden")}
        >
          <span>When</span>
          <span>Activity</span>
          <span>By</span>
          <span>Type</span>
          <span />
        </div>

        {isLoading ? (
          <div className="grid gap-3 py-4" aria-busy="true">
            <Skeleton className="h-12 w-full" label="Loading activity" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          !isError && (
            <EmptyState
              icon={<ScrollText size={22} />}
              title={filter === "all" ? "No activity yet" : `No ${SYSTEM_ACTIVITY_TYPE_LABELS[filter].toLowerCase()} activity`}
              description={filter === "all" ? "What people and TANAW do will show here." : "Choose All to see every entry."}
              minHeightClassName="min-h-48"
            />
          )
        ) : (
          <ul aria-label="Activity entries">
            {rows.map((row) => (
              <ActivityRow key={row.log.id} row={row} expanded={row.log.id === expandedId} onToggle={() => onExpand(row.log.id === expandedId ? null : row.log.id)} timeFormat={timeFormat} />
            ))}
          </ul>
        )}
      </div>

      {!isLoading && filtered.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[0.84375rem] text-(--tanaw-text-secondary)">
          <p role="status" className="tabular-nums">
            Showing {rows.length.toLocaleString("en-US")} of {filtered.length.toLocaleString("en-US")} {filtered.length === 1 ? "entry" : "entries"}
          </p>
          {remaining > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setPages(Math.ceil(shown / SYSTEM_ACTIVITY_PAGE_SIZE) + 1)}>
              Show {Math.min(remaining, SYSTEM_ACTIVITY_PAGE_SIZE)} more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ row, expanded, onToggle, timeFormat }: { row: SystemActivityRow; expanded: boolean; onToggle: () => void; timeFormat: SystemTimeFormat }) {
  const { log } = row;
  const panelId = `activity-detail-${log.id}`;
  return (
    <li className="border-b border-(--tanaw-border-soft)">
      <button
        type="button"
        data-activity-row={log.id}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          ROW_GRID,
          "w-full items-start px-3 py-3.5 text-left text-(--tanaw-text) transition-colors hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
          expanded && "bg-(--tanaw-selected-bg) hover:bg-(--tanaw-selected-bg)",
        )}
      >
        <span className="text-sm max-lg:order-2 max-lg:col-start-1 max-lg:flex max-lg:gap-1.5 max-lg:text-[0.8125rem] max-lg:text-(--tanaw-text-secondary)">
          <span className="block font-semibold max-lg:font-medium">{row.day}</span>
          <span className="block text-(--tanaw-text-secondary) tabular-nums">
            <span className="lg:hidden" aria-hidden="true">
              ·{" "}
            </span>
            {formatPhilippineTime(log.timestamp, timeFormat)}
          </span>
        </span>
        <span className="min-w-0 max-lg:order-1 max-lg:col-start-1">
          <span className="block font-semibold">{row.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-[0.84375rem] text-(--tanaw-text-secondary)">{log.summary}</span>
        </span>
        <span className="min-w-0 text-sm max-lg:order-3 max-lg:col-start-1 max-lg:text-[0.8125rem]">
          <span className="block font-semibold wrap-break-word max-lg:inline">{row.actor}</span>
          {row.role && (
            <span className="block text-(--tanaw-text-secondary) max-lg:inline">
              <span className="lg:hidden">, </span>
              {row.role}
            </span>
          )}
        </span>
        <span className={cn("text-[0.84375rem] font-semibold max-lg:order-4 max-lg:col-start-1", TYPE_TEXT[row.type])}>{row.typeLabel}</span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cn("mt-0.5 text-(--tanaw-text-secondary) transition-transform motion-reduce:transition-none max-lg:col-start-2 max-lg:row-start-1", expanded && "rotate-180")}
        />
      </button>
      {expanded && <ActivityDetail log={log} id={panelId} />}
    </li>
  );
}

function FieldList({ fields }: { fields: readonly TechnicalField[] }) {
  return (
    <>
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="text-xs text-(--tanaw-text-muted)">{field.label}</dt>
          <dd className={cn("mt-0.5 text-sm wrap-anywhere text-(--tanaw-text)", field.mono && "font-mono text-[0.8125rem]")}>
            {field.value}
            {field.detail && <span className="mt-0.5 block font-mono text-xs text-(--tanaw-text-muted)">{field.detail}</span>}
          </dd>
        </div>
      ))}
    </>
  );
}

function ActivityDetail({ log, id }: { log: SystemActivityLog; id: string }) {
  const links = systemActivityLinks(log);
  return (
    <div id={id} role="region" aria-label={`Technical detail: ${log.action}`} className="bg-(--tanaw-surface-inset) px-4 pt-3.5 pb-4">
      {log.itDetail?.trim() && (
        <div className="mb-3.5">
          <p className="text-xs text-(--tanaw-text-muted)">Technical detail</p>
          <p className="mt-0.5 font-mono text-[0.8125rem] wrap-anywhere whitespace-pre-wrap text-(--tanaw-text)">{log.itDetail.trim()}</p>
        </div>
      )}
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 max-lg:grid-cols-1">
        <FieldList fields={activityOriginFields(log)} />
      </dl>
      <dl className="mt-3.5 grid grid-cols-3 gap-x-6 gap-y-3 border-t border-(--tanaw-border-soft) pt-3.5 max-lg:grid-cols-1">
        <FieldList fields={activityIdFields(log)} />
      </dl>
      {links.length > 0 && (
        <p className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {links.map((link) => (
            <Link key={link.to} to={link.to} className={linkButton}>
              {link.label}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}
