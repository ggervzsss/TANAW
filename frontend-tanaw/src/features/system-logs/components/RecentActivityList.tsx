import { LayoutGroup, motion, useReducedMotion, type Transition } from "motion/react";
import type { ReactNode } from "react";
import type { SystemLog } from "@/shared/types";
import { Skeleton, cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { ACTIVITY_PAGE_SIZE, activityKind, activityKindChipLabels, activityTitle, actorRoleLabel, formatActivityDate, formatActivityTime } from "../model/recentActivity";

export const activityChipClass = "inline-flex min-h-6 items-center rounded-tanaw-sm px-2 text-xs leading-tight font-semibold whitespace-nowrap";

/** The open-row highlight's glide: the app's 150–260ms ease-out. */
const GLIDE: Transition = { type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] };

export function ActivityTypeChip({ log }: { log: SystemLog }) {
  return <span className={cn(activityChipClass, "bg-(--ra-chip) text-(--ra-chip-ink)")}>{activityKindChipLabels[activityKind(log)]}</span>;
}

export const ACTIVITY_DRAWER_ID = "activity-details-drawer";

/**
 * The four columns every row lines up on: date and time, activity, performed by, details. On phones
 * the same cells stack into one row (recentActivity.css), so nothing scrolls sideways.
 */
export const activityColumns = "tanaw-activity-cols grid grid-cols-[9.5rem_minmax(14rem,1.25fr)_minmax(12rem,1fr)_minmax(16rem,1.6fr)] gap-5";

/** A row's box: the hover tint, the radius and the keyboard focus ring come with `tanaw-activity-row`. */
export const activityRowClass =
  "tanaw-activity-row w-full px-3 py-4 text-left text-sm text-(--tanaw-text) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)";

/**
 * The flat activity list: grid rows, each a button that opens the details drawer. `pinned` sits
 * between the column headers and the records (the busy places on the Admin page).
 */
export function RecentActivityList({
  rows,
  selectedId,
  timeFormat,
  empty,
  pinned,
  onSelect,
}: {
  rows: readonly SystemLog[];
  selectedId: string | null;
  timeFormat: SystemTimeFormat;
  empty: ReactNode;
  pinned?: ReactNode;
  onSelect: (log: SystemLog) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="overflow-x-auto max-[60rem]:overflow-x-visible">
      <div className="min-[60rem]:min-w-240">
        <div aria-hidden="true" className={cn(activityColumns, "tanaw-activity-head border-b border-(--tanaw-border-soft) px-3 pb-3 max-md:hidden")}>
          <span>Date &amp; time</span>
          <span>Activity</span>
          <span>Performed by</span>
          <span>Details</span>
        </div>
        {pinned}
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
                      className={cn(activityColumns, activityRowClass)}
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

/** A skeleton bar in a box of its line's height, so a loading row is as tall as the row it stands in for. */
function SkeletonLine({ height, bar }: { height: string; bar: string }) {
  return (
    <span className={cn("flex items-center", height)}>
      <Skeleton className={bar} />
    </span>
  );
}

/** A page of rows (ACTIVITY_PAGE_SIZE) in the shape of the activity list while the records load. */
export function RecentActivitySkeleton() {
  return (
    <div role="status" aria-label="Loading activity">
      <div aria-hidden="true">
        {Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, index) => (
          <span key={index} className="block border-b border-(--tanaw-border-soft) py-0.5">
            <span className={cn(activityColumns, "px-3 py-4")}>
              <span className="block">
                <SkeletonLine height="h-5" bar="h-3.5 w-24" />
                <SkeletonLine height="h-5" bar="h-3 w-16" />
              </span>
              <span className="block">
                <SkeletonLine height="h-5" bar="h-3.5 w-40" />
                <Skeleton className="mt-1.5 h-6 w-20 rounded-tanaw-sm" />
              </span>
              <span className="block">
                <SkeletonLine height="h-5" bar="h-3.5 w-28" />
                <SkeletonLine height="h-[19.5px]" bar="h-3 w-16" />
              </span>
              <span className="block">
                <SkeletonLine height="h-5.25" bar="h-3.5 w-full" />
                <SkeletonLine height="h-5.25" bar="h-3.5 w-3/4" />
              </span>
            </span>
          </span>
        ))}
      </div>
      <span className="sr-only">Loading activity.</span>
    </div>
  );
}
