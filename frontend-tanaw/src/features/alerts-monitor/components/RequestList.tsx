import { LayoutGroup, motion, useReducedMotion, type Transition } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import type { Request } from "@/shared/services/requests";
import { formatRequestTime, requestMarker, requestPlace, statusLabels, statusTextClass, type RequestDayGroup } from "../model";
import "../requests.css";

/** The chosen-row highlight's glide: the app's 150–260ms ease-out. */
const GLIDE: Transition = { type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] };

type RequestListProps = {
  groups: RequestDayGroup[];
  selectedId: string | null;
  timeFormat: SystemTimeFormat;
  onSelect: (request: Request) => void;
  /** Shown instead of the groups when nothing is listed. */
  empty?: ReactNode;
};

/** The left pane: requests grouped by day under sticky day headings. */
export function RequestList({ groups, selectedId, timeFormat, onSelect, empty }: RequestListProps) {
  const reduceMotion = useReducedMotion();
  return (
    <nav
      aria-label="Requests"
      className="tanaw-requests-list max-h-184 overflow-y-auto overscroll-contain border-r border-(--tanaw-border-soft) pr-3 scrollbar-gutter-stable max-[980px]:max-h-none max-[980px]:border-r-0 max-[980px]:pr-0"
    >
      {groups.length === 0 ? (
        empty
      ) : (
        <LayoutGroup id="admin-requests-list">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`requests-day-${group.key}`}>
              <h2
                id={`requests-day-${group.key}`}
                className="sticky top-0 z-2 m-0 border-b border-(--tanaw-border-soft) bg-(--tanaw-page) px-4 pt-3 pb-2 text-[13px] font-semibold text-(--tanaw-text-secondary)"
              >
                {group.label}
              </h2>
              <ul className="m-0 list-none p-0">
                {group.requests.map((request) => (
                  <RequestListItem
                    key={request.id}
                    request={request}
                    selected={request.id === selectedId}
                    marker={requestMarker(request)}
                    timeFormat={timeFormat}
                    onSelect={onSelect}
                    glide={reduceMotion ? { duration: 0 } : GLIDE}
                  />
                ))}
              </ul>
            </section>
          ))}
        </LayoutGroup>
      )}
    </nav>
  );
}

function RequestListItem({
  request,
  selected,
  marker,
  timeFormat,
  onSelect,
  glide,
}: {
  request: Request;
  selected: boolean;
  marker: "New" | "Updated" | null;
  timeFormat: SystemTimeFormat;
  onSelect: (request: Request) => void;
  glide: Transition;
}) {
  const time = formatRequestTime(request.createdAt, timeFormat);
  return (
    <li className="tanaw-requests-item">
      {selected && <motion.span layoutId="admin-request-selection" aria-hidden="true" className="tanaw-requests-selection" transition={glide} />}
      <button type="button" aria-current={selected ? "true" : undefined} onClick={() => onSelect(request)} className="tanaw-requests-row">
        <span className="flex justify-between gap-3 text-[13px] text-(--tanaw-text-secondary)">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {request.group}
            {marker && <span className="font-semibold text-(--tanaw-accent-ink)">{marker}</span>}
          </span>
          {time && (
            <time dateTime={request.createdAt} className="shrink-0 tabular-nums">
              {time}
            </time>
          )}
        </span>
        <span className={cn("mt-1 block text-[0.96875rem] leading-snug", marker ? "font-bold" : "font-semibold", selected && "text-(--tanaw-accent-ink)")}>{request.title}</span>
        <span className="mt-0.5 block text-sm text-(--tanaw-text-secondary)">{requestPlace(request)}</span>
        <span className={cn("mt-2 block text-[13px] font-semibold", statusTextClass[request.status])}>{statusLabels[request.status]}</span>
      </button>
    </li>
  );
}
