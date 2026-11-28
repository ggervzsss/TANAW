import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Check, FileText, Landmark, Menu, LockKeyhole, MapPin } from "lucide-react";
import { Skeleton } from "../../../ui-kit";
import type { DailyOrigins, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import type { SystemTimeFormat } from "../../../utils/date-time";
import { getDemographicAllocationStatus } from "../utils/demographics";
import { VisitorDetails } from "./VisitorDetails";
import { ReportDayPicker } from "./ReportDayPicker";
import { dailyOriginsError, formatReportDate, missingDays, type ReportDay } from "../model/daily-origins";
import type { ReportLifecycle } from "../model/report-lifecycle";
import { ReportLifecycleBanner, ReportStatusLine, ReportsNeedingAction } from "./ReportLifecycle";
import { useSelectedReportDay } from "../hooks/useSelectedReportDay";
import { ReportAuditTrail } from "./ReportAuditTrail";
import { ReportDraftActions } from "./ReportDraftActions";
import { SupplementaryNotes } from "./SupplementaryNotes";

type Props = {
  enterpriseName: string;
  attractionType?: string;
  reviewed?: boolean;
  activeReport: ReportRecord | null;
  days: ReportDay[];
  demo: DemoBreakdown;
  hasDailyOrigins: boolean;
  isReadOnly: boolean;
  isPeriodChanging: boolean;
  metricsError: string | null;
  /** The months Tourism Period can switch to, oldest first. */
  months: string[];
  onSelectPeriod: (period: string) => void;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  validationError: string | null;
  onSubmitPrompt: () => void;
  onReview: () => void;
  setOrigins: Dispatch<SetStateAction<DailyOrigins>>;
  setNotes: Dispatch<SetStateAction<string>>;
  /** Where the month's report stands once sent: waiting, returned, refused or being corrected. */
  lifecycle: ReportLifecycle;
  reports: ReportRecord[];
  timeFormat: SystemTimeFormat;
  reopeningReportId: string | null;
  reopenIssue: string | null;
  onCorrect: (report: ReportRecord) => void;
  onAskForHelp: (report: ReportRecord) => void;
  /** Changes when a send or reopen ends; focus then moves to the report's new status. */
  statusAnnouncement: number;
  /** Other months whose report was returned or refused, and how to open one. */
  reportsAwaitingAction: ReportRecord[];
  onOpenReportMonth: (report: ReportRecord) => void;
};

export function ReportDraftPanel({
  enterpriseName,
  attractionType,
  reviewed = false,
  activeReport,
  days,
  demo,
  hasDailyOrigins,
  isReadOnly,
  isPeriodChanging,
  metricsError,
  months,
  onSelectPeriod,
  metrics,
  notes,
  period,
  validationError,
  onSubmitPrompt,
  onReview,
  setOrigins,
  setNotes,
  lifecycle,
  reports,
  timeFormat,
  reopeningReportId,
  reopenIssue,
  onCorrect,
  onAskForHelp,
  statusAnnouncement,
  reportsAwaitingAction,
  onOpenReportMonth,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const selectedDay = useSelectedReportDay(days, period);
  const dailyDay = hasDailyOrigins ? selectedDay : null;
  const complete = (!hasDailyOrigins || missingDays(days).length === 0) && getDemographicAllocationStatus(demo, metrics.unique).isComplete && !metricsError && !isPeriodChanging;
  const submitted = Boolean(activeReport && ["Submitted", "Consolidated"].includes(activeReport.status));
  const waitingForUpload = activeReport?.syncStatus === "pending_cloud_sync";
  const uploadRejected = activeReport?.syncStatus === "upload_rejected";
  // The submit dialog closes onto a panel whose Submit button is gone; focus its new status.
  useEffect(() => {
    if (!statusAnnouncement) return;
    const frame = window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("[data-lifecycle-focus]")?.focus({ preventScroll: false }));
    return () => window.cancelAnimationFrame(frame);
  }, [statusAnnouncement]);
  const firstMissing = hasDailyOrigins && !isReadOnly ? missingDays(days)[0] : undefined;
  const fixDay =
    firstMissing && dailyDay && validationError === dailyOriginsError(days) && dailyDay.day.date !== firstMissing.date
      ? { label: `Show ${formatReportDate(firstMissing.date)}`, onShow: () => dailyDay.select(firstMissing.date) }
      : null;
  const steps = [
    { label: "Complete Visitor Details", done: complete },
    { label: "Review Report Form", done: submitted || (reviewed && complete) },
    { label: "Submit Report", done: submitted && !waitingForUpload && !uploadRejected },
  ];
  return (
    <section ref={panelRef} className="report-create-card" aria-label="Monthly DOT Visitor Report" aria-busy={isPeriodChanging}>
      <ReportLifecycleBanner
        lifecycle={lifecycle}
        reports={reports}
        timeFormat={timeFormat}
        reopeningReportId={reopeningReportId}
        reopenIssue={reopenIssue}
        onCorrect={onCorrect}
        onAskForHelp={onAskForHelp}
      />
      <ReportsNeedingAction reports={reportsAwaitingAction} onOpen={onOpenReportMonth} />
      <div className="report-information">
        <div className="report-information-left">
          <header>
            <h2>Monthly DOT Visitor Report</h2>
            <ReportStatusLine lifecycle={lifecycle} timeFormat={timeFormat} />
          </header>
          <dl className="report-information-fields">
            <div>
              <dt>Tourism Site / Attraction</dt>
              <dd>
                <MapPin aria-hidden="true" />
                <span>{enterpriseName}</span>
              </dd>
            </div>
            <div>
              <dt>Tourism Attraction</dt>
              <dd>
                <Landmark aria-hidden="true" />
                <span>{attractionType ?? "Not recorded"}</span>
              </dd>
            </div>
            <div>
              <dt>Tourism Period</dt>
              {/* The month to report on, and for daily reports the day Visitor Details shows. */}
              <dd>
                <ReportDayPicker
                  period={period}
                  months={months}
                  days={days}
                  selectedDate={dailyDay?.day.date ?? null}
                  isLoading={isPeriodChanging}
                  onSelect={dailyDay?.select}
                  onSelectMonth={onSelectPeriod}
                />
              </dd>
            </div>
          </dl>
        </div>
        <div className="report-system-count" role="group" aria-label="Visitor counted by TANAW">
          <div>
            <h3>Visitor counted by TANAW</h3>
            <output aria-label="System unique visitor count" aria-busy={isPeriodChanging}>
              {isPeriodChanging ? (
                <>
                  <Skeleton className="report-count-skeleton" />
                  <span className="sr-only">Loading</span>
                </>
              ) : metrics.counting || activeReport ? (
                metrics.unique.toLocaleString()
              ) : (
                "—"
              )}
            </output>
            <p>Unique Visitor</p>
          </div>
          <div className="report-readonly">
            <strong>
              <LockKeyhole aria-hidden="true" />
              Read only
            </strong>
            <p>
              Automatically loaded
              <br />
              from the system
            </p>
          </div>
        </div>
      </div>
      <div className="report-create-body">
        <section className="report-visitor-card" aria-label="Visitor Details">
          <VisitorDetails
            selected={dailyDay}
            hasDailyOrigins={hasDailyOrigins}
            demo={demo}
            metrics={metrics}
            isLoading={isPeriodChanging}
            isReadOnly={isReadOnly || isPeriodChanging}
            setOrigins={setOrigins}
          />
        </section>
        <aside className="report-next-steps" aria-label="Next Steps">
          <h3>
            <Menu aria-hidden="true" />
            Next Steps
          </h3>
          <ol>
            {steps.map((step, index) => (
              <li key={step.label} data-complete={step.done} aria-current={!step.done && (index === 0 || steps[index - 1].done) ? "step" : undefined}>
                <span className="report-step-indicator" aria-hidden="true">
                  {step.done && <Check />}
                </span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
          <div className="report-workflow-actions">
            <button type="button" className="reports-button reports-primary" disabled={isPeriodChanging} onClick={onReview}>
              <FileText aria-hidden="true" />
              Review Report Form
            </button>
            <ReportDraftActions
              isReadOnly={isReadOnly}
              isPeriodChanging={isPeriodChanging}
              isLoadingCounts={isPeriodChanging}
              metricsError={metricsError}
              validationError={validationError}
              fixDay={fixDay}
              onSubmitPrompt={onSubmitPrompt}
            />
          </div>
        </aside>
      </div>
      {/* Supporting workflows stay behind one disclosure so the form fits one screen. */}
      <div className="report-supporting-controls">
        <details>
          <summary>Report notes and audit trail</summary>
          <div className="report-supporting-content">
            <SupplementaryNotes isReadOnly={isReadOnly} notes={notes} setNotes={setNotes} />
            <ReportAuditTrail activeReport={activeReport} />
          </div>
        </details>
      </div>
    </section>
  );
}
