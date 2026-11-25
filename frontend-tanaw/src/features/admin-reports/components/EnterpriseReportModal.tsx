import { X } from "lucide-react";
import { motion } from "motion/react";
import { useId, useMemo, useRef, useState } from "react";
import { MONTH_NAMES, submissionTone } from "@/features/reports/model/reportStatuses";
import { Button, ModalPortal, StatusPill, cn, dialogIn, useDialogFocus } from "@/shared/ui-kit";
import type { FinalReport, SystemLog } from "@/shared/types";
import {
  buildMonthEntry,
  historyMonths,
  historyYears,
  needsAllMonths,
  summarizeYear,
  type EnterpriseReportProfile,
  type ReportIndex,
} from "../model/enterpriseReports";
import { monthKeyId, type MonthKey } from "../model/reportMonths";
import { ReportHistory } from "./ReportHistory";

type EnterpriseReportModalProps = {
  profile: EnterpriseReportProfile;
  /** The month the modal opens on (the page's reporting month, or the month in a link). */
  viewedMonth: MonthKey;
  reportIndex: ReportIndex;
  reviewers: Map<string, string>;
  logs: readonly SystemLog[];
  finalReports: readonly FinalReport[];
  today: Date;
  onClose: () => void;
};

function locationLine(barangay: string) {
  const name = barangay.trim();
  if (!name || name === "Unassigned") return "San Pedro, Laguna";
  return `${/^brgy\.?\s/i.test(name) ? name : `Brgy. ${name}`}, San Pedro, Laguna`;
}

/** "Jan 2025" */
function formatMonthYear(date: Date) {
  return `${MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;
}

/**
 * One enterprise's report details: contact and camera facts, then its report submission history by
 * year. It opens on the viewed month with that month's report log expanded.
 */
export function EnterpriseReportModal({ profile, viewedMonth, reportIndex, reviewers, logs, finalReports, today, onClose }: EnterpriseReportModalProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const subtitleId = useId();
  useDialogFocus(panelRef, onClose);

  const years = useMemo(() => historyYears(profile, today), [profile, today]);
  const [year, setYear] = useState(() => (years.includes(viewedMonth.year) ? viewedMonth.year : years[0]));
  const months = useMemo(() => historyMonths(profile, year, today), [profile, today, year]);
  const entries = useMemo(() => months.map((month) => buildMonthEntry(profile.id, month, reportIndex, reviewers, today)), [months, profile.id, reportIndex, reviewers, today]);
  const [expandedKey, setExpandedKey] = useState<string | null>(() => {
    const key = monthKeyId(viewedMonth);
    return months.some((month) => monthKeyId(month) === key) ? key : null;
  });
  const [showAll, setShowAll] = useState(() => needsAllMonths(months, viewedMonth));

  const yearSummaries = useMemo(
    () =>
      years.map((value) =>
        summarizeYear(
          value,
          historyMonths(profile, value, today).map((month) => buildMonthEntry(profile.id, month, reportIndex, reviewers, today)),
        ),
      ),
    [profile, reportIndex, reviewers, today, years],
  );
  const summary = yearSummaries.find((item) => item.year === year) ?? summarizeYear(year, entries);

  const focused = entries.find((entry) => entry.key === expandedKey) ?? buildMonthEntry(profile.id, viewedMonth, reportIndex, reviewers, today);
  const hideContact = focused.submission !== "Submitted";

  const chooseYear = (value: number) => {
    setYear(value);
    setExpandedKey(null);
    setShowAll(false);
  };

  const info: { label: string; value: string | null; contact?: boolean; wrap?: boolean }[] = [
    { label: "Contact person", value: profile.contactPerson, contact: true },
    { label: "Email", value: profile.email, contact: true, wrap: true },
    { label: "Phone", value: profile.phone, contact: true },
    { label: "Cameras", value: profile.cameras },
    { label: "Registered", value: profile.registeredAt ? formatMonthYear(profile.registeredAt) : null },
  ];

  return (
    <ModalPortal lockScroll>
      <motion.div
        className="fixed inset-0 z-1300 flex items-center justify-center bg-[rgb(9_24_17/0.48)] px-5 py-8 backdrop-blur-[2px] max-sm:px-3 max-sm:py-4 dark:bg-[rgb(0_0_0/0.62)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.section
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitleId}
          tabIndex={-1}
          {...dialogIn}
          className="flex max-h-[calc(100dvh-4rem)] w-full max-w-230 flex-col overflow-hidden rounded-tanaw-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface) text-(--tanaw-text) shadow-[0_24px_64px_rgb(4_20_12/0.28)] outline-none max-sm:max-h-[calc(100dvh-2rem)]"
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-(--tanaw-border-soft) px-7.5 pt-5.5 pb-4 max-sm:px-5">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-[1.75rem] leading-[1.15] font-bold wrap-break-word max-sm:text-2xl">
                {profile.name}
              </h2>
              <p id={subtitleId} className="mt-1.5 text-[0.90625rem] text-(--tanaw-text-secondary)">
                {locationLine(profile.barangay)}
              </p>
              <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <StatusPill tone={submissionTone[focused.submission]}>
                  <span className="sr-only">{focused.period} report: </span>
                  {focused.submission}
                </StatusPill>
                <span className="text-[0.8125rem] text-(--tanaw-text-muted)">{focused.period}</span>
                {profile.category && (
                  <span className="ml-1 inline-flex min-h-6 items-center rounded-full border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-2.5 text-xs font-semibold text-(--tanaw-text-secondary)">
                    {profile.category}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close report details"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-colors hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-7.5 pt-5 pb-3.5 max-sm:px-5">
            <dl className="m-0 grid grid-cols-3 gap-x-7 gap-y-4 text-[0.90625rem] max-md:grid-cols-2 max-sm:grid-cols-1">
              {info.map((item) => {
                const shown = item.contact && hideContact ? null : item.value;
                return (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-[0.78125rem] text-(--tanaw-text-muted)">{item.label}</dt>
                    <dd className={cn("mt-1 font-semibold", item.wrap && "wrap-anywhere", !shown && "text-(--tanaw-text-muted)")}>
                      {shown ?? <span aria-label="Not available">—</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>

            <ReportHistory
              year={year}
              years={years}
              yearSummaries={yearSummaries}
              summary={summary}
              entries={entries}
              expandedKey={expandedKey}
              showAll={showAll}
              today={today}
              enterpriseName={profile.name}
              logs={logs}
              finalReports={finalReports}
              onYearChange={chooseYear}
              onToggleMonth={(key) => setExpandedKey((current) => (current === key ? null : key))}
              onToggleShowAll={() => setShowAll((current) => !current)}
            />
          </div>

          <footer className="flex shrink-0 justify-end border-t border-(--tanaw-border-soft) px-7.5 py-3.5 max-sm:px-5">
            <Button variant="secondary" onClick={onClose} className="h-11 min-w-25">
              Close
            </Button>
          </footer>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
