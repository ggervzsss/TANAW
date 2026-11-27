import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useRef, type ReactNode } from "react";
import { formatRequestTime, requestPlace } from "@/features/alerts-monitor/model";
import type { Request } from "@/shared/services/requests";
import { cn } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { ownerShort, requestState, stateDotClass, stateLabels, stateTextClass, type RequestDayGroup, type Viewer } from "../model";
import "../itRequests.css";

type ITRequestListProps = {
  groups: RequestDayGroup[];
  selectedId: string | null;
  viewer: Viewer;
  timeFormat: SystemTimeFormat;
  onSelect: (request: Request) => void;
  /** Shown instead of the groups when nothing is listed. */
  empty?: ReactNode;
};

/** The selection tint glides to the chosen request instead of jumping. */
const GLIDE = { type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] } as const;

/** The left pane: requests under sticky day headings, each with its status, owner and reference number. */
export function ITRequestList({ groups, selectedId, viewer, timeFormat, onSelect, empty }: ITRequestListProps) {
  const navRef = useRef<HTMLElement | null>(null);
  // A day heading takes the page colour only while it is stuck over rows scrolling under it, so at rest
  // it sits on the page (and its green wash) without a band behind it.
  const markStuckHeadings = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const top = nav.getBoundingClientRect().top;
    for (const heading of nav.querySelectorAll<HTMLElement>("[data-day-heading]")) {
      const section = heading.parentElement;
      if (section && section.getBoundingClientRect().top < top - 0.5) heading.dataset.stuck = "";
      else delete heading.dataset.stuck;
    }
  }, []);
  return (
    <motion.nav
      ref={navRef}
      onScroll={markStuckHeadings}
      layoutScroll
      aria-label="Requests"
      className="max-h-208 scrollbar-gutter-stable overflow-y-auto overscroll-contain border-r border-(--tanaw-border-soft) pr-3 max-[980px]:max-h-none max-[980px]:border-r-0 max-[980px]:pr-0"
    >
      {groups.length === 0 ? (
        empty
      ) : (
        <LayoutGroup id="it-requests-list">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`it-requests-day-${group.key}`}>
              <h2 id={`it-requests-day-${group.key}`} data-day-heading className="it-requests__day sticky top-0 z-2 m-0 px-3 pt-3 pb-1.5 text-[0.8125rem] font-semibold text-(--tanaw-text-secondary)">
                {group.label}
              </h2>
              <ul className="m-0 list-none p-0">
                {group.requests.map((request) => (
                  <ListItem key={request.id} request={request} selected={request.id === selectedId} viewer={viewer} timeFormat={timeFormat} onSelect={onSelect} />
                ))}
              </ul>
            </section>
          ))}
        </LayoutGroup>
      )}
    </motion.nav>
  );
}

function ListItem({ request, selected, viewer, timeFormat, onSelect }: { request: Request; selected: boolean; viewer: Viewer; timeFormat: SystemTimeFormat; onSelect: (request: Request) => void }) {
  const reduceMotion = useReducedMotion();
  const state = requestState(request);
  const owner = ownerShort(request, viewer);
  const time = formatRequestTime(request.createdAt, timeFormat);
  return (
    <li className="it-requests__row" data-selected={selected || undefined}>
      {selected && <motion.span layoutId="it-request-selection" aria-hidden="true" className="it-requests__selection" transition={reduceMotion ? { duration: 0 } : GLIDE} />}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(request)}
        className="rounded-tanaw-md relative z-1 block w-full cursor-pointer px-3 py-3.5 text-left text-(--tanaw-text) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
      >
        <span className="flex justify-between gap-3 text-[0.8125rem] text-(--tanaw-text-secondary)">
          <span className="min-w-0">{request.group}</span>
          {time && (
            <time dateTime={request.createdAt} className="shrink-0 tabular-nums">
              {time}
            </time>
          )}
        </span>
        <span
          className={cn("mt-1 block text-[0.96875rem] leading-snug transition-colors duration-150", state === "not-picked-up" ? "font-bold" : "font-medium", selected && "text-(--tanaw-accent-ink)")}
        >
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
