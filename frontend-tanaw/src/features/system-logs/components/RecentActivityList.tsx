import type { ReactNode } from "react";
import type { SystemLog } from "@/shared/types";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { activityKind, activityKindChipLabels, activityTitle, actorRoleLabel, formatActivityDate, formatActivityTime } from "../model/recentActivity";

const chipClass = "inline-flex min-h-5.5 items-center rounded-full px-2.5 text-xs leading-tight font-semibold whitespace-nowrap";

export function ActivityTypeChip({ log }: { log: SystemLog }) {
  return <span className={cn(chipClass, "bg-(--ra-chip) text-(--ra-chip-ink)")}>{activityKindChipLabels[activityKind(log)]}</span>;
}

export const ACTIVITY_DRAWER_ID = "activity-details-drawer";

const columns = "grid grid-cols-[9.5rem_minmax(14rem,1.25fr)_minmax(12rem,1fr)_minmax(16rem,1.6fr)] gap-5";

/** The flat activity list: grid rows, each a button that opens the details drawer. */
export function RecentActivityList({
  rows,
  selectedId,
  timeFormat,
  empty,
  onSelect,
}: {
  rows: readonly SystemLog[];
  selectedId: string | null;
  timeFormat: SystemTimeFormat;
  empty: ReactNode;
  onSelect: (log: SystemLog) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-240">
        <div aria-hidden="true" className={cn(columns, "border-b border-(--tanaw-border-soft) px-3 pb-3 text-[0.6875rem] font-bold tracking-[0.12em] text-(--tanaw-text-secondary) uppercase")}>
          <span>Date &amp; time</span>
          <span>Activity</span>
          <span>Performed by</span>
          <span>Details</span>
        </div>
        {rows.length === 0 ? (
          empty
        ) : (
          <ul aria-label="Activity records">
            {rows.map((log) => {
              const open = log.id === selectedId;
              return (
                <li key={log.id}>
                  <button
                    type="button"
                    data-activity-row={log.id}
                    data-activity-kind={activityKind(log)}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-controls={open ? ACTIVITY_DRAWER_ID : undefined}
                    onClick={() => onSelect(log)}
                    className={cn(
                      columns,
                      "w-full border-b px-3 py-4 text-left text-sm text-(--tanaw-text) transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
                      "border-(--tanaw-border-soft) hover:bg-(--tanaw-control-hover)",
                      open && "bg-(--tanaw-row-selected) shadow-[inset_3px_0_0_var(--tanaw-action)] hover:bg-(--tanaw-row-selected)",
                    )}
                  >
                    <span className="tabular-nums">
                      <span className="block font-bold">{formatActivityDate(log.timestamp)}</span>
                      <span className="block text-(--tanaw-text-secondary)">{formatActivityTime(log.timestamp, timeFormat)}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold wrap-break-word">{activityTitle(log)}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        <ActivityTypeChip log={log} />
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold wrap-break-word">{log.actor}</span>
                      <span className="block text-[0.8125rem] text-(--tanaw-text-secondary)">{actorRoleLabel(log.actorRole)}</span>
                    </span>
                    <span className="line-clamp-3 min-w-0 leading-normal wrap-break-word text-(--tanaw-text-secondary)">{log.summary}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
