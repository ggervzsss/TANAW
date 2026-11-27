import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { formatShortDate, reviewTone, submissionTone } from "@/features/reports/model/reportStatuses";
import { SegmentedControl, Select, StatusPill, cn } from "@/shared/ui-kit";
import type { FinalReport, SystemLog } from "@/shared/types";
import { HISTORY_PREVIEW_MONTHS, missingNote, pendingNote, yearOptionNote, type ReportMonthEntry, type YearSummary } from "../model/enterpriseReports";
import { buildReportLog } from "../model/reportLog";

/** Up to this many years show as one row of choices; more use a dropdown. */
const YEAR_CHOICES_MAX = 4;

type ReportHistoryProps = {
  year: number;
  years: readonly number[];
  yearSummaries: readonly YearSummary[];
  summary: YearSummary;
  entries: readonly ReportMonthEntry[];
  expandedKey: string | null;
  showAll: boolean;
  today: Date;
  enterpriseName: string;
  logs: readonly SystemLog[];
  finalReports: readonly FinalReport[];
  onYearChange: (year: number) => void;
  onToggleMonth: (key: string) => void;
  onToggleShowAll: () => void;
};

/** "Nov 4", or when nothing was sent, the due date that is coming or has passed. */
function sentLine(entry: ReportMonthEntry) {
  if (entry.sentAt) return { text: formatShortDate(entry.sentAt), tone: "" };
  if (entry.submission === "Missing") return { text: `Was due ${formatShortDate(entry.dueAt)}`, tone: "text-(--tanaw-st-missing)" };
  return { text: `Due ${formatShortDate(entry.dueAt)}`, tone: "text-(--tanaw-text-secondary)" };
}

/**
 * Report Submission History: the year, the year's figures, and its months as a one-open-at-a-time
 * list. The table, header included, scrolls with the dialog as one piece (no scroll box or pinned
 * header of its own), and an opened month scrolls its report log into view.
 */
export function ReportHistory({
  year,
  years,
  yearSummaries,
  summary,
  entries,
  expandedKey,
  showAll,
  today,
  enterpriseName,
  logs,
  finalReports,
  onYearChange,
  onToggleMonth,
  onToggleShowAll,
}: ReportHistoryProps) {
  const headingId = useId();
  const thisYear = today.getFullYear();
  const yearOptions = useMemo(
    () =>
      years.map((value) => {
        const item = yearSummaries.find((candidate) => candidate.year === value);
        return { value: String(value), label: value === thisYear ? `${value} (this year)` : String(value), meta: item ? yearOptionNote(item) : undefined };
      }),
    [thisYear, yearSummaries, years],
  );
  const visible = showAll ? entries : entries.slice(0, HISTORY_PREVIEW_MONTHS);
  const hasMore = entries.length > HISTORY_PREVIEW_MONTHS;

  // Bring a month the admin opens fully into view, report log included. The month opened with the
  // dialog stays where it is.
  const listRef = useRef<HTMLUListElement>(null);
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!openedOnce.current) {
      openedOnce.current = true;
      return;
    }
    if (!expandedKey) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-month="${expandedKey}"]`);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    item?.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [expandedKey]);

  const figures = [
    { label: "Submitted", sub: `of the reports due in ${year}`, value: `${summary.submitted} of ${summary.due}`, note: null, color: undefined },
    {
      label: "Pending",
      sub: "not sent yet, before the due date",
      value: String(summary.pending.length),
      note: pendingNote(summary),
      color: summary.pending.length > 0 ? "text-(--tanaw-st-pending)" : undefined,
    },
    {
      label: "Missing",
      sub: "not sent by the due date",
      value: String(summary.missing.length),
      note: missingNote(summary),
      color: summary.missing.length > 0 ? "text-(--tanaw-st-missing)" : undefined,
    },
  ];

  return (
    <section aria-labelledby={headingId} className="mt-5 border-t border-(--tanaw-border-soft) pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div>
          <h3 id={headingId} className="text-lg leading-snug font-[650] tracking-[-0.01em]">
            Report Submission History
          </h3>
          <p className="mt-1 text-[13px] text-(--tanaw-text-secondary)">Select a month to see its report log.</p>
        </div>
        {years.length === 1 ? null : years.length <= YEAR_CHOICES_MAX ? (
          <SegmentedControl
            ariaLabel="Year"
            value={String(year)}
            onChange={(value) => onYearChange(Number(value))}
            options={years.map((value) => ({ value: String(value), label: String(value) }))}
            size="sm"
          />
        ) : (
          <Select label="Year" value={String(year)} onChange={(value) => onYearChange(Number(value))} options={yearOptions} className="min-w-56" />
        )}
      </div>

      <dl className="tanaw-er-figures mt-4">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt>
              <span className="block text-sm font-semibold">{figure.label}</span>
              <span className="block text-[13px] text-(--tanaw-text-muted)">{figure.sub}</span>
            </dt>
            <dd className="m-0 mt-2">
              <span className={cn("font-display block text-[1.5rem] leading-none font-bold tabular-nums", figure.color)}>{figure.value}</span>
              {figure.note && <span className="mt-1.5 block text-[13px] text-(--tanaw-text-secondary)">{figure.note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <div
          aria-hidden="true"
          className="tanaw-er-month-cols tanaw-er-month-head tanaw-er-head border-b border-(--tanaw-border-soft) px-3 py-2.5"
        >
          <span />
          <span>Period</span>
          <span className="tanaw-er-optional">Report ID</span>
          <span>Sent</span>
          <span>Submission</span>
          <span>Staff review</span>
          <span className="tanaw-er-optional">Reviewed by</span>
        </div>
        {entries.length === 0 ? (
          <p className="m-0 px-3 py-6 text-sm text-(--tanaw-text-secondary)">No reporting months in {year} yet.</p>
        ) : (
          <ul key={year} ref={listRef} aria-label={`Report months of ${year}`} className="tanaw-er-fade m-0 list-none p-0">
            {visible.map((entry) => {
              const open = entry.key === expandedKey;
              const logId = `er-log-${entry.key}`;
              const events = open ? buildReportLog(entry, enterpriseName, logs, finalReports) : [];
              const sent = sentLine(entry);
              return (
                <li key={entry.key} data-month={entry.key} className="tanaw-er-month-item" data-open={open}>
                  <button type="button" aria-expanded={open} aria-controls={open ? logId : undefined} onClick={() => onToggleMonth(entry.key)} className="tanaw-er-month-row tanaw-er-month-cols">
                    <ChevronRight size={16} aria-hidden="true" className="tanaw-er-month-chevron" />
                    <span className="font-semibold whitespace-nowrap">{entry.period}</span>
                    <span className="tanaw-er-optional whitespace-nowrap text-(--tanaw-text-secondary) tabular-nums">
                      <span className="sr-only">Report ID </span>
                      {entry.reportCode ?? "—"}
                    </span>
                    <span className={cn("whitespace-nowrap", sent.tone)}>
                      <span className="sr-only">Sent </span>
                      {sent.text}
                    </span>
                    <span>
                      <StatusPill tone={submissionTone[entry.submission]}>
                        <span className="sr-only">Submission: </span>
                        {entry.submission}
                      </StatusPill>
                    </span>
                    <span>
                      <StatusPill tone={reviewTone[entry.review]}>
                        <span className="sr-only">Staff review: </span>
                        {entry.review}
                      </StatusPill>
                    </span>
                    <span className={cn("tanaw-er-optional truncate", !entry.reviewedBy && "text-(--tanaw-text-muted)")}>
                      <span className="sr-only">Reviewed by </span>
                      {entry.reviewedBy ?? "—"}
                    </span>
                  </button>
                  {open && (
                    <div id={logId} className="tanaw-er-log pt-1 pr-4.5 pb-2 pl-10.5 max-sm:pl-4">
                      <p className="m-0 text-[13px] font-semibold text-(--tanaw-text-secondary)">
                        Report log · <span>{entry.period}</span>
                      </p>
                      <ol aria-label={`${entry.period} report log`} className="m-0 mt-3 list-none py-0 pr-0 pl-1.5">
                        {events.map((event) => (
                          <li key={event.id} className="tanaw-er-log-item">
                            <span aria-hidden="true" className="tanaw-er-log-dot" data-tone={event.tone} />
                            <p className="m-0 text-sm font-semibold">
                              {event.title} <span className="ml-1.5 text-[13px] font-medium text-(--tanaw-text-muted)">{event.when}</span>
                            </p>
                            <p className="m-0 mt-1 text-[13px] text-(--tanaw-text-secondary)">{event.detail}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && (
          <div className="border-t border-(--tanaw-border-soft) px-2 pt-1">
            <button
              type="button"
              aria-expanded={showAll}
              onClick={onToggleShowAll}
              className="tanaw-er-more inline-flex min-h-11 items-center gap-1.5 rounded-tanaw-md px-3 text-sm font-semibold text-(--tanaw-accent-ink) hover:bg-(--tanaw-control-bg-hover) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
            >
              {showAll ? "Show fewer months" : `Show all ${entries.length} months of ${year}`}
              <ChevronDown size={15} aria-hidden="true" className={cn(showAll && "rotate-180")} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
