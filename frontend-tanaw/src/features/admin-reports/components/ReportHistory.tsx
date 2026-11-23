import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useMemo } from "react";
import { formatShortDate, reviewTone, submissionTone } from "@/features/reports/model/reportStatuses";
import { Select, StatusPill, cn } from "@/shared/ui-kit";
import type { FinalReport, SystemLog } from "@/shared/types";
import {
  HISTORY_PREVIEW_MONTHS,
  missingNote,
  pendingNote,
  yearOptionNote,
  type ReportMonthEntry,
  type YearSummary,
} from "../model/enterpriseReports";
import { buildReportLog } from "../model/reportLog";

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

/** Report Submission History: a year picker, the year's figures, and the months as a one-open-at-a-time list. */
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

  const figures = [
    { label: "Reports submitted", sub: `due reports in ${year}`, value: `${summary.submitted} of ${summary.due}`, note: null, color: undefined },
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
    <section aria-labelledby={headingId} className="mt-5.5 flex min-h-0 flex-1 flex-col border-t border-(--tanaw-border-soft) pt-4.5">
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
        <div>
          <h3 id={headingId} className="font-display text-xl font-bold">
            Report Submission History
          </h3>
          <p className="mt-0.5 text-[0.8125rem] text-(--tanaw-text-muted)">Monthly reports sent by this enterprise. Select a month to see its report log.</p>
        </div>
        <Select label="Year" value={String(year)} onChange={(value) => onYearChange(Number(value))} options={yearOptions} className="min-w-56" />
      </div>

      <dl className="mt-3.5 grid grid-cols-3 border-y border-(--tanaw-border-soft) max-sm:grid-cols-1">
        {figures.map((figure, index) => (
          <div
            key={figure.label}
            className={cn("py-3 pr-5", index > 0 && "border-l border-(--tanaw-border-soft) pl-5 max-sm:border-t max-sm:border-l-0 max-sm:pl-0")}
          >
            <dt>
              <span className="block text-[0.84375rem] font-bold">{figure.label}</span>
              <span className="block text-xs text-(--tanaw-text-muted)">{figure.sub}</span>
            </dt>
            <dd className="mt-1.5">
              <span className={cn("block font-display text-[1.625rem] leading-none font-bold tabular-nums", figure.color)}>{figure.value}</span>
              {figure.note && <span className="mt-1.5 block text-[0.78125rem] text-(--tanaw-text-secondary)">{figure.note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <div
        role="region"
        aria-label={`Report months of ${year}, scrollable`}
        tabIndex={0}
        className="tanaw-er-scroll mt-3 min-h-48 flex-1 overflow-auto overscroll-contain rounded-xl border border-(--tanaw-border-soft)"
      >
        <div className="min-w-205">
          <div
            aria-hidden="true"
            className="tanaw-er-month-cols sticky top-0 z-1 bg-(--tanaw-surface-inset) px-3 py-2.75 text-[0.6875rem] font-bold tracking-widest text-(--tanaw-text-secondary) uppercase"
          >
            <span />
            <span>Period</span>
            <span>Report ID</span>
            <span>Sent on</span>
            <span>Due</span>
            <span>Submission</span>
            <span>Staff review</span>
            <span>Reviewed by</span>
          </div>
          {entries.length === 0 ? (
            <p className="m-0 px-3 py-6 text-sm text-(--tanaw-text-secondary)">No reporting months in {year} yet.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {visible.map((entry) => {
                const open = entry.key === expandedKey;
                const logId = `er-log-${entry.key}`;
                const events = open ? buildReportLog(entry, enterpriseName, logs, finalReports) : [];
                return (
                  <li key={entry.key} className="tanaw-er-month-item" data-open={open}>
                    <button type="button" aria-expanded={open} aria-controls={open ? logId : undefined} onClick={() => onToggleMonth(entry.key)} className="tanaw-er-month-row tanaw-er-month-cols">
                      <ChevronRight size={16} aria-hidden="true" className="tanaw-er-month-chevron" />
                      <span className="font-bold whitespace-nowrap">{entry.period}</span>
                      <span className="whitespace-nowrap text-(--tanaw-text-secondary) tabular-nums">
                        <span className="sr-only">Report ID </span>
                        {entry.reportCode ?? (entry.submission === "Missing" ? "Not received" : "Not sent yet")}
                      </span>
                      <span className="text-(--tanaw-text-secondary)">
                        <span className="sr-only">Sent on </span>
                        {entry.sentAt ? formatShortDate(entry.sentAt) : "—"}
                      </span>
                      <span className="text-(--tanaw-text-secondary)">
                        <span className="sr-only">Due </span>
                        {formatShortDate(entry.dueAt)}
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
                      <span className={cn(!entry.reviewedBy && "text-(--tanaw-text-muted)")}>
                        <span className="sr-only">Reviewed by </span>
                        {entry.reviewedBy ?? "—"}
                      </span>
                    </button>
                    {open && (
                      <div id={logId} className="pt-1 pr-4.5 pb-1.5 pl-11">
                        <p className="m-0 text-[0.6875rem] font-bold tracking-widest text-(--tanaw-text-secondary) uppercase">
                          Report log · <span className="tracking-normal normal-case">{entry.period}</span>
                        </p>
                        <ol aria-label={`${entry.period} report log`} className="m-0 mt-3 list-none py-0 pr-0 pl-1.5">
                          {events.map((event) => (
                            <li key={event.id} className="tanaw-er-log-item">
                              <span aria-hidden="true" className="tanaw-er-log-dot" data-tone={event.tone} />
                              <p className="m-0 text-sm font-bold">
                                {event.title} <span className="ml-1.5 text-[0.78125rem] font-medium text-(--tanaw-text-muted)">{event.when}</span>
                              </p>
                              <p className="m-0 mt-0.75 text-[0.84375rem] text-(--tanaw-text-secondary)">{event.detail}</p>
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
            <div className="border-t border-(--tanaw-border-soft) px-2 pt-0.5 pb-2">
              <button
                type="button"
                aria-expanded={showAll}
                onClick={onToggleShowAll}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-(--tanaw-accent-ink) hover:underline focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
              >
                {showAll ? "Show fewer months" : `Show all ${entries.length} months of ${year}`}
                <ChevronDown size={15} aria-hidden="true" className={cn("transition-transform", showAll && "rotate-180")} />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
