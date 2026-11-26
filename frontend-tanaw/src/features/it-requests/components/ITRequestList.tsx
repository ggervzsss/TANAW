import type { ReactNode } from "react";
import { formatRequestTime, requestPlace } from "@/features/alerts-monitor/model";
import type { Request } from "@/shared/services/requests";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { ownerShort, requestState, stateDotClass, stateLabels, stateTextClass, type RequestDayGroup, type Viewer } from "../model";

type ITRequestListProps = {
  groups: RequestDayGroup[];
  selectedId: string | null;
  viewer: Viewer;
  timeFormat: SystemTimeFormat;
  onSelect: (request: Request) => void;
  /** Shown instead of the groups when nothing is listed. */
  empty?: ReactNode;
};

/** The left pane: requests under sticky day headings, each with its status, owner and reference number. */
export function ITRequestList({ groups, selectedId, viewer, timeFormat, onSelect, empty }: ITRequestListProps) {
  return (
    <nav aria-label="Requests" className="max-h-208 scrollbar-gutter-stable overflow-y-auto overscroll-contain border-r border-(--tanaw-border-soft) max-[980px]:max-h-none max-[980px]:border-r-0">
      {groups.length === 0
        ? empty
        : groups.map((group) => (
            <section key={group.key} aria-labelledby={`it-requests-day-${group.key}`}>
              <h2
                id={`it-requests-day-${group.key}`}
                className="sticky top-0 z-1 m-0 border-b border-(--tanaw-border-soft) bg-(--tanaw-page) px-4 pt-2.5 pb-1.5 text-[0.8125rem] font-bold text-(--tanaw-text-secondary)"
              >
                {group.label}
              </h2>
              <ul className="m-0 list-none p-0">
                {group.requests.map((request) => (
                  <ListItem key={request.id} request={request} selected={request.id === selectedId} viewer={viewer} timeFormat={timeFormat} onSelect={onSelect} />
                ))}
              </ul>
            </section>
          ))}
    </nav>
  );
}

function ListItem({ request, selected, viewer, timeFormat, onSelect }: { request: Request; selected: boolean; viewer: Viewer; timeFormat: SystemTimeFormat; onSelect: (request: Request) => void }) {
  const state = requestState(request);
  const owner = ownerShort(request, viewer);
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
          <span className="min-w-0">{request.group}</span>
          {time && (
            <time dateTime={request.createdAt} className="shrink-0 tabular-nums">
              {time}
            </time>
          )}
        </span>
        <span className={cn("mt-1 block text-[0.96875rem] leading-snug", state === "not-picked-up" ? "font-extrabold" : "font-semibold", selected && "text-(--tanaw-accent-ink)")}>
          {request.title}
        </span>
        <span className="mt-0.5 block text-sm text-(--tanaw-text-secondary)">{requestPlace(request)}</span>
        <span className="mt-2 flex items-center gap-2 text-[0.8125rem] font-semibold">
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", stateDotClass[state])} />
          <span className={stateTextClass[state]}>{stateLabels[state]}</span>
          {owner && <span className="min-w-0 truncate font-medium text-(--tanaw-text-muted)">· {owner}</span>}
          <span className="ml-auto shrink-0 font-medium text-(--tanaw-text-muted) tabular-nums">{request.code}</span>
        </span>
      </button>
    </li>
  );
}
