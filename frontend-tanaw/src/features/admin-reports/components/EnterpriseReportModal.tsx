import { X } from "lucide-react";
import { motion } from "motion/react";
import { useId, useMemo, useRef, useState } from "react";
import { MONTH_NAMES, submissionTone } from "@/features/reports/model/reportStatuses";
import { ModalPortal, StatusPill, cn, dialogIn, easeOut, useDialogFocus } from "@/shared/ui-kit";
import type { FinalReport, SystemLog } from "@/shared/types";
import { buildMonthEntry, historyMonths, historyYears, needsAllMonths, summarizeYear, type EnterpriseReportProfile, type ReportIndex } from "../model/enterpriseReports";
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
 * One enterprise's report details: a compact line of contact and camera facts, then its report
 * submission history by year. The header names the opened month's status and stays put while months
 * are expanded below; the whole dialog body scrolls as one, so the month list and its report logs are
 * never squeezed into a scroll box of their own.
 */
export function EnterpriseReportModal({ profile, viewedMonth, reportIndex, reviewers, logs, finalReports, today, onClose }: EnterpriseReportModalProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  // The header draws its hairline only once the body has scrolled under it.
  const [scrolled, setScrolled] = useState(false);
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

  // The opened month, not the expanded row, sets the header: expanding other months does not change it.
  const viewed = useMemo(() => buildMonthEntry(profile.id, viewedMonth, reportIndex, reviewers, today), [profile.id, reportIndex, reviewers, today, viewedMonth]);
  const showContact = viewed.submission === "Submitted";

  const chooseYear = (value: number) => {
    setYear(value);
    setExpandedKey(null);
    setShowAll(false);
  };

  const facts: { label: string; value: string | null; wrap?: boolean }[] = [
    ...(showContact
      ? [
          { label: "Contact person", value: profile.contactPerson },
          { label: "Email", value: profile.email, wrap: true },
          { label: "Phone", value: profile.phone },
        ]
      : []),
    { label: "Cameras", value: profile.cameras },
    { label: "Registered", value: profile.registeredAt ? formatMonthYear(profile.registeredAt) : null },
  ];

  return (
    <ModalPortal lockScroll>
      <motion.div
        className="tanaw-dialog-backdrop fixed inset-0 z-1300 flex min-h-dvh items-center justify-center overflow-y-auto overscroll-contain p-4 sm:p-6 max-md:p-0!"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: easeOut }}
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
          // Phones: a full-screen sheet, so the months and their logs get the whole screen.
          className="tanaw-dialog relative my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-230 flex-col overflow-hidden rounded-tanaw-2xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) text-(--tanaw-text) shadow-tanaw-dialog outline-none sm:max-h-[calc(100dvh-3rem)] max-md:my-0 max-md:h-dvh max-md:max-h-dvh! max-md:rounded-none max-md:border-0"
        >
          <header
            data-scrolled={scrolled || undefined}
            className="flex shrink-0 items-start justify-between gap-5 border-b border-transparent px-7 pt-6 pb-5 transition-colors duration-200 ease-tanaw-out data-scrolled:border-(--tanaw-border-soft) max-md:gap-3 max-md:px-4 max-md:pt-[max(1rem,env(safe-area-inset-top))] max-md:pb-4"
          >
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-2xl leading-tight font-bold tracking-[-0.015em] wrap-break-word max-sm:text-xl">
                {profile.name}
              </h2>
              <p id={subtitleId} className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(--tanaw-text-secondary)">
                <span>{locationLine(profile.barangay)}</span>
                {profile.category && (
                  <>
                    <span aria-hidden="true" className="text-(--tanaw-text-muted)">
                      ·
                    </span>
                    <span>{profile.category}</span>
                  </>
                )}
              </p>
              <p className="mt-3.5 flex flex-wrap items-center gap-2 text-[13px] text-(--tanaw-text-secondary)">
                <span className="font-semibold text-(--tanaw-text)">{viewed.period} report</span>
                <StatusPill tone={submissionTone[viewed.submission]}>{viewed.submission}</StatusPill>
                {viewed.submissionNote && <span className="text-(--tanaw-text-muted)">{viewed.submissionNote}</span>}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close report details"
              onClick={onClose}
              className="-mt-0.5 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full max-md:-mt-1.5 max-md:size-11 text-(--tanaw-text-muted) transition-[background-color,color,rotate,scale] duration-200 ease-tanaw-out hover:rotate-90 hover:bg-(--tanaw-control-bg-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-90 motion-reduce:transition-none motion-reduce:hover:rotate-0"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div
            onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
            className="tanaw-er-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pt-1 pb-7 max-md:px-4 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <dl className="tanaw-er-facts m-0 border-t border-(--tanaw-border-soft) pt-4">
              {facts.map((fact) => (
                <div key={fact.label} className="min-w-0">
                  <dt className="text-[13px] text-(--tanaw-text-muted)">{fact.label}</dt>
                  <dd className={cn("m-0 mt-1 text-sm font-semibold", fact.wrap && "wrap-anywhere", !fact.value && "text-(--tanaw-text-muted)")}>
                    {fact.value ?? <span aria-label="Not available">—</span>}
                  </dd>
                </div>
              ))}
              {!showContact && (
                <div className="min-w-0">
                  <dt className="text-[13px] text-(--tanaw-text-muted)">Contact details</dt>
                  <dd className="m-0 mt-1 text-sm text-(--tanaw-text-secondary)">Shown once the {viewed.period} report is sent.</dd>
                </div>
              )}
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
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
