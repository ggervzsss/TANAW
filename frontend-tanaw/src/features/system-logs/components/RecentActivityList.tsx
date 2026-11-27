import { LayoutGroup, motion, useReducedMotion, type Transition } from "motion/react";
import type { ReactNode } from "react";
import type { SystemLog } from "@/shared/types";
import { Skeleton, cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { activityKind, activityKindChipLabels, activityTitle, actorRoleLabel, formatActivityDate, formatActivityTime } from "../model/recentActivity";

const chipClass = "inline-flex min-h-6 items-center rounded-tanaw-sm px-2 text-xs leading-tight font-semibold whitespace-nowrap";

/** The open-row highlight's glide: the app's 150–260ms ease-out. */
const GLIDE: Transition = { type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] };

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
  const reduceMotion = useReducedMotion();
  return (
    <div className="overflow-x-auto">
      <div className="min-w-240">
        <div aria-hidden="true" className={cn(columns, "tanaw-activity-head border-b border-(--tanaw-border-soft) px-3 pb-3")}>
          <span>Date &amp; time</span>
          <span>Activity</span>
          <span>Performed by</span>
          <span>Details</span>
        </div>
        {rows.length === 0 ? (
          empty
        ) : (
          <LayoutGroup id="recent-activity-list">
            <ul aria-label="Activity records">
              {rows.map((log) => {
                const open = log.id === selectedId;
                return (
                  <li key={log.id} className="tanaw-activity-item">
                    {open && <motion.span layoutId="recent-activity-selection" aria-hidden="true" className="tanaw-activity-selection" transition={reduceMotion ? { duration: 0 } : GLIDE} />}
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
                        "tanaw-activity-row w-full px-3 py-4 text-left text-sm text-(--tanaw-text) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
                      )}
                    >
                      <span className="tabular-nums">
                        <span className="block font-semibold">{formatActivityDate(log.timestamp)}</span>
                        <span className="block text-(--tanaw-text-secondary)">{formatActivityTime(log.timestamp, timeFormat)}</span>
                      </span>
                      <span className="min-w-0">
                        <span className={cn("tanaw-activity-title block font-semibold wrap-break-word", open && "text-(--tanaw-accent-ink)")}>{activityTitle(log)}</span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          <ActivityTypeChip log={log} />
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold wrap-break-word">{log.actor}</span>
                        <span className="block text-[13px] text-(--tanaw-text-secondary)">{actorRoleLabel(log.actorRole)}</span>
                      </span>
                      <span className="line-clamp-3 min-w-0 leading-normal wrap-break-word text-(--tanaw-text-secondary)">{log.summary}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </LayoutGroup>
        )}
      </div>
    </div>
  );
}

/** Rows in the shape of the activity list while the records load. */
export function RecentActivitySkeleton() {
  return (
    <div role="status" aria-label="Loading activity">
      <div aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className={cn(columns, "border-b border-(--tanaw-border-soft) px-3 py-4")}>
            <span className="block">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-2 h-3 w-16" />
            </span>
            <span className="block">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton shape="pill" className="mt-2 h-5 w-20" />
            </span>
            <span className="block">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-2 h-3 w-16" />
            </span>
            <span className="block">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="mt-2 h-3.5 w-3/4" />
            </span>
          </span>
        ))}
      </div>
      <span className="sr-only">Loading activity.</span>
    </div>
  );
}
