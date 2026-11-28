import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { SystemLog } from "@/shared/types";
import { Button, ModalPortal, StatusPill, cn, initialsOf, useDialogFocus } from "@/shared/ui-kit";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import {
  activityDetailFields,
  activityKind,
  activityLinks,
  activityReference,
  activityTitle,
  actorRoleLabel,
  formatActivityDate,
  formatActivityTime,
} from "../model/recentActivity";
import { ACTIVITY_DRAWER_ID, ActivityTypeChip } from "./RecentActivityList";

const sectionLabel = "text-[15px] font-[650] text-(--tanaw-text)";

/** The activity details drawer, docked right. Escape, the scrim and the close button close it. */
export function RecentActivityDrawer({
  log,
  position,
  total,
  timeFormat,
  onClose,
  onPrevious,
  onNext,
}: {
  log: SystemLog;
  /** 0-based index in the filtered list, or -1 when the activity is outside it. */
  position: number;
  total: number;
  timeFormat: SystemTimeFormat;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const whenId = useId();
  // The header draws its hairline only once the details have scrolled under it, as in dialogs.
  const [scrolled, setScrolled] = useState(false);
  useDialogFocus(panelRef, onClose);
  const fields = activityDetailFields(log);
  const links = activityLinks(log);
  const time = formatActivityTime(log.timestamp, timeFormat);

  return (
    <ModalPortal lockScroll>
      <div className="tanaw-activity-drawer fixed inset-0 z-1200">
        <div aria-hidden="true" className="tanaw-activity-drawer__scrim tanaw-dialog-backdrop absolute inset-0" onClick={onClose} />
        <aside
          ref={panelRef}
          id={ACTIVITY_DRAWER_ID}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={whenId}
          tabIndex={-1}
          data-activity-kind={activityKind(log)}
          className="tanaw-activity-drawer__panel absolute inset-y-0 right-0 flex w-[min(540px,100%)] flex-col border-l border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) text-base text-(--tanaw-text) shadow-tanaw-dialog outline-none"
        >
          <header
            data-scrolled={scrolled || undefined}
            className="border-b border-transparent px-7 pt-6 pb-5 transition-colors duration-200 ease-tanaw-out data-scrolled:border-(--tanaw-border-soft) max-md:px-4 max-md:pt-[max(1rem,env(safe-area-inset-top))]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap gap-1.5 pt-1">
                <ActivityTypeChip log={log} />
              </div>
              <button
                type="button"
                aria-label="Close activity details"
                onClick={onClose}
                className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-[background-color,color,rotate,scale] duration-200 ease-tanaw-out hover:rotate-90 hover:bg-(--tanaw-control-bg-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-90 motion-reduce:transition-none motion-reduce:hover:rotate-0"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <h2 id={titleId} className="mt-2.5 font-display text-2xl leading-tight font-bold tracking-[-0.015em] wrap-break-word">
              {activityTitle(log)}
            </h2>
            <p id={whenId} className="mt-2 text-sm text-(--tanaw-text-secondary) tabular-nums">
              {formatActivityDate(log.timestamp)}
              {time && ` at ${time}`} · {activityReference(log)}
            </p>
          </header>

          <div
            key={log.id}
            onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
            className="tanaw-activity-drawer__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pt-1 pb-7 max-md:px-4"
          >
            <section aria-labelledby={`${titleId}-who`}>
              <h3 id={`${titleId}-who`} className={sectionLabel}>
                Performed by
              </h3>
              <div className="mt-3 flex items-center gap-3">
                <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-(--tanaw-surface-inset) font-bold text-(--tanaw-accent-ink)">
                  {initialsOf(log.actor) || "?"}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold wrap-break-word">{log.actor}</span>
                  <span className="block text-sm text-(--tanaw-text-secondary)">{actorRoleLabel(log.actorRole)}</span>
                </span>
              </div>
            </section>

            <section aria-labelledby={`${titleId}-what`} className="mt-6">
              <h3 id={`${titleId}-what`} className={sectionLabel}>
                What happened
              </h3>
              <p className="mt-2 leading-relaxed wrap-break-word">{log.summary}</p>
            </section>

            {log.itDetail && (
              <section aria-labelledby={`${titleId}-it`} className="mt-6">
                <h3 id={`${titleId}-it`} className={sectionLabel}>
                  Technical details
                </h3>
                <p className="mt-2 border-l-2 border-(--tanaw-border) py-0.5 pl-4 text-[0.9375rem] leading-relaxed wrap-break-word text-(--tanaw-text-secondary)">{log.itDetail}</p>
              </section>
            )}

            {fields.length > 0 && (
              <section aria-labelledby={`${titleId}-details`} className="mt-6">
                <h3 id={`${titleId}-details`} className={sectionLabel}>
                  Details
                </h3>
                <dl className="mt-2 border-t border-(--tanaw-border-soft) text-[0.9375rem]">
                  {fields.map((field) => (
                    <div key={field.label} className="grid grid-cols-[11rem_minmax(0,1fr)] gap-3 border-b border-(--tanaw-border-soft) py-3 max-sm:grid-cols-1 max-sm:gap-1">
                      <dt className="text-(--tanaw-text-muted)">{field.label}</dt>
                      <dd className="font-semibold wrap-break-word">{field.tone ? <StatusPill tone={field.tone}>{field.value}</StatusPill> : field.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {links.length > 0 && (
              <nav aria-label="Related pages" className="mt-5 -mx-3 flex flex-col">
                {links.map((link) => (
                  <Link
                    key={`${link.label}-${link.to}`}
                    to={link.to}
                    className="tanaw-activity-link group mt-0.5 flex min-h-12 items-center justify-between gap-3 rounded-tanaw-md px-3 text-[0.9375rem] font-semibold text-(--tanaw-accent-ink) no-underline hover:bg-(--tanaw-control-bg-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
                  >
                    {link.label}
                    <ChevronRight size={16} aria-hidden="true" className="transition-transform duration-200 ease-tanaw-out group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
                  </Link>
                ))}
              </nav>
            )}
          </div>

          <footer className="tanaw-activity-drawer__foot flex items-center justify-between gap-3 border-t border-(--tanaw-border-soft) px-7 py-4 max-md:px-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex gap-2">
              <Button variant="secondary" aria-label="Previous activity" disabled={position <= 0} onClick={onPrevious} leadingIcon={<ChevronLeft size={15} aria-hidden="true" />}>
                Previous
              </Button>
              <Button variant="secondary" aria-label="Next activity" disabled={position < 0 || position >= total - 1} onClick={onNext} trailingIcon={<ChevronRight size={15} aria-hidden="true" />}>
                Next
              </Button>
            </div>
            <p className={cn("text-sm text-(--tanaw-text-secondary) tabular-nums")} aria-live="polite">
              {position >= 0 ? `${position + 1} of ${total}` : "Not in the current list"}
            </p>
          </footer>
        </aside>
      </div>
    </ModalPortal>
  );
}
