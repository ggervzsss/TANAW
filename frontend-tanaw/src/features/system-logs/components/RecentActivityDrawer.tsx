import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useId, useRef } from "react";
import { Link } from "react-router-dom";
import type { SystemLog } from "@/shared/types";
import { ModalPortal, StatusPill, cn, initialsOf, useDialogFocus } from "@/shared/ui-kit";
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
  isPinnedActivity,
  openDurationLabel,
} from "../model/recentActivity";
import { ACTIVITY_DRAWER_ID, ActivityTypeChip, UnresolvedChip } from "./RecentActivityList";

const sectionLabel = "text-[0.8125rem] font-bold tracking-[0.08em] text-(--tanaw-text-secondary) uppercase";
const navButton =
  "inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-(--tanaw-control-border) bg-(--tanaw-surface) px-3.5 text-sm font-semibold text-(--tanaw-text) transition-colors hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-(--tanaw-surface)";

function resolutionSentence(log: SystemLog) {
  if (log.resolutionStatus === "Unresolved") return "IT has not marked this resolved yet, so it stays pinned at the top of Recent Activity.";
  if (log.resolutionStatus === "Resolved") return "IT has marked this resolved.";
  return null;
}

/** The activity details drawer, docked right. Escape, the scrim and the close button close it. */
export function RecentActivityDrawer({
  log,
  position,
  total,
  now,
  timeFormat,
  onClose,
  onPrevious,
  onNext,
}: {
  log: SystemLog;
  /** 0-based index in the filtered list, or -1 when the activity is outside it. */
  position: number;
  total: number;
  now: Date;
  timeFormat: SystemTimeFormat;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const whenId = useId();
  useDialogFocus(panelRef, onClose);
  const pinned = isPinnedActivity(log);
  const fields = activityDetailFields(log);
  const links = activityLinks(log);
  const resolution = resolutionSentence(log);
  const time = formatActivityTime(log.timestamp, timeFormat);

  return (
    <ModalPortal lockScroll>
      <div className="tanaw-activity-drawer fixed inset-0 z-1200">
        <div aria-hidden="true" className="tanaw-activity-drawer__scrim absolute inset-0 bg-(--ra-scrim)" onClick={onClose} />
        <aside
          ref={panelRef}
          id={ACTIVITY_DRAWER_ID}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={whenId}
          tabIndex={-1}
          data-activity-kind={activityKind(log)}
          className="tanaw-activity-drawer__panel absolute inset-y-0 right-0 flex w-[min(540px,100%)] flex-col border-l border-(--tanaw-border-soft) bg-(--tanaw-surface) text-base text-(--tanaw-text) shadow-[-24px_0_56px_rgb(4_20_12/0.22)] outline-none"
        >
          <header className="border-b border-(--tanaw-border-soft) px-6.5 pt-5.5 pb-4.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap gap-1.5 pt-1">
                <ActivityTypeChip log={log} />
                {pinned && <UnresolvedChip>Unresolved, open {openDurationLabel(log.timestamp, now)}</UnresolvedChip>}
              </div>
              <button
                type="button"
                aria-label="Close activity details"
                onClick={onClose}
                className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-(--tanaw-text-secondary) transition-colors hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <h2 id={titleId} className="font-display mt-2 text-[1.75rem] leading-[1.15] font-bold wrap-break-word">
              {activityTitle(log)}
            </h2>
            <p id={whenId} className="mt-2 text-[0.9375rem] text-(--tanaw-text-secondary) tabular-nums">
              {formatActivityDate(log.timestamp)}
              {time && ` at ${time}`} · {activityReference(log)}
            </p>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6.5 py-5.5">
            <section aria-labelledby={`${titleId}-who`}>
              <h3 id={`${titleId}-who`} className={sectionLabel}>
                Performed by
              </h3>
              <div className="mt-3 flex items-center gap-3">
                <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-(--tanaw-surface-inset) font-bold text-(--tanaw-accent-ink)">
                  {initialsOf(log.actor) || "?"}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold wrap-break-word">{log.actor}</span>
                  <span className="block text-sm text-(--tanaw-text-secondary)">{actorRoleLabel(log.actorRole)}</span>
                </span>
              </div>
            </section>

            <section aria-labelledby={`${titleId}-what`} className="mt-6">
              <h3 id={`${titleId}-what`} className={sectionLabel}>
                What happened
              </h3>
              <p className="mt-2 leading-relaxed wrap-break-word">{log.summary}</p>
              {resolution && <p className="mt-2 leading-relaxed text-(--tanaw-text-secondary)">{resolution}</p>}
            </section>

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
              <nav aria-label="Related pages" className="mt-6 flex flex-col gap-2">
                {links.map((link) => (
                  <Link
                    key={`${link.label}-${link.to}`}
                    to={link.to}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-(--tanaw-border-soft) px-4 text-[0.9375rem] font-semibold text-(--tanaw-accent-ink) no-underline transition-colors hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
                  >
                    {link.label}
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                ))}
              </nav>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-(--tanaw-border-soft) px-6.5 py-3.5">
            <div className="flex gap-2">
              <button type="button" aria-label="Previous activity" disabled={position <= 0} onClick={onPrevious} className={navButton}>
                <ChevronLeft size={14} aria-hidden="true" />
                Previous
              </button>
              <button type="button" aria-label="Next activity" disabled={position < 0 || position >= total - 1} onClick={onNext} className={navButton}>
                Next
                <ChevronRight size={14} aria-hidden="true" />
              </button>
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
