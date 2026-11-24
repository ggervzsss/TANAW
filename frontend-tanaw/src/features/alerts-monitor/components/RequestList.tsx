import type { ReactNode } from "react";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import type { Request } from "@/shared/services/requests";
import { formatRequestTime, requestMarker, requestPlace, statusLabels, statusTextClass, type RequestDayGroup } from "../model";

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
  return (
    <nav
      aria-label="Requests"
      className="tanaw-requests-list max-h-184 overflow-y-auto overscroll-contain border-r border-(--tanaw-border-soft) scrollbar-gutter-stable max-[980px]:max-h-none max-[980px]:border-r-0"
    >
      {groups.length === 0
        ? empty
        : groups.map((group) => (
            <section key={group.key} aria-labelledby={`requests-day-${group.key}`}>
              <h2
                id={`requests-day-${group.key}`}
                className="sticky top-0 z-1 m-0 border-b border-(--tanaw-border-soft) bg-(--tanaw-page) px-4 pt-2.5 pb-1.5 text-[0.8125rem] font-bold text-(--tanaw-text-secondary)"
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
                  />
                ))}
              </ul>
            </section>
          ))}
    </nav>
  );
}

function RequestListItem({
  request,
  selected,
  marker,
  timeFormat,
  onSelect,
}: {
  request: Request;
  selected: boolean;
  marker: "New" | "Updated" | null;
  timeFormat: SystemTimeFormat;
  onSelect: (request: Request) => void;
}) {
  const time = formatRequestTime(request.createdAt, timeFormat);
  return (
    <li className="border-b border-(--tanaw-border-soft)">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(request)}
        className={cn(
          "block w-full cursor-pointer p-4 text-left text-(--tanaw-text) transition-colors hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
          selected && "bg-(--tanaw-row-selected) shadow-[inset_3px_0_0_var(--tanaw-action)] hover:bg-(--tanaw-row-selected)",
        )}
      >
        <span className="flex justify-between gap-3 text-[0.78125rem] text-(--tanaw-text-secondary)">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {request.group}
            {request.urgent && <span className="font-bold text-(--tanaw-danger)">Urgent</span>}
            {marker && <span className="font-bold text-(--tanaw-accent-ink)">{marker}</span>}
          </span>
          {time && (
            <time dateTime={request.createdAt} className="shrink-0 tabular-nums">
              {time}
            </time>
          )}
        </span>
        <span className={cn("mt-1 block text-[0.96875rem] leading-snug", marker ? "font-extrabold" : "font-semibold", selected && "text-(--tanaw-accent-ink)")}>{request.title}</span>
        <span className="mt-0.5 block text-sm text-(--tanaw-text-secondary)">{requestPlace(request)}</span>
        <span className={cn("mt-2 block text-[0.8125rem] font-semibold", statusTextClass[request.status])}>{statusLabels[request.status]}</span>
      </button>
    </li>
  );
}
