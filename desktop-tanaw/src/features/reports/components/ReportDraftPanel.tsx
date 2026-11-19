import { type Dispatch, type SetStateAction } from "react";
import { CalendarDays, Check, FileText, Info, Landmark, Menu, LockKeyhole, MapPin } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { DailyOrigins, DemoBreakdown, Metrics, ReportRecord, SystemLogPeriod } from "../../../types/enterprise";
import { useAuthStore } from "../../login/stores/auth-store";
import { formatReportingPeriodLabel } from "../utils/reporting-period";
import { getDemographicAllocationStatus } from "../utils/demographics";
import { VisitorDetails } from "./VisitorDetails";
import { missingDays, type ReportDay } from "../model/daily-origins";
import { ReportAuditTrail } from "./ReportAuditTrail";
import { ReportDraftActions } from "./ReportDraftActions";
import { ReportDraftAlerts } from "./ReportDraftAlerts";
import { SupplementaryNotes } from "./SupplementaryNotes";
import { CountingDetails } from "./CountingDetails";

type Props = {
  enterpriseName: string;
  reviewed?: boolean;
  activeReport: ReportRecord | null;
  activeReportId: string | null;
  days: ReportDay[];
  demo: DemoBreakdown;
  hasDailyOrigins: boolean;
  isReadOnly: boolean;
  isPeriodChanging: boolean;
  metricsError: string | null;
  metrics: Metrics;
  notes: string;
  period: SystemLogPeriod;
  validationError: string | null;
  onSubmitPrompt: () => void;
  onReview: () => void;
  onRefreshCounts?: () => void;
  setOrigins: Dispatch<SetStateAction<DailyOrigins>>;
  setNotes: Dispatch<SetStateAction<string>>;
};

export function ReportDraftPanel({
  enterpriseName,
  reviewed = false,
  activeReport,
  activeReportId,
  days,
  demo,
  hasDailyOrigins,
  isReadOnly,
  isPeriodChanging,
  metricsError,
  metrics,
  notes,
  period,
  validationError,
  onSubmitPrompt,
  onReview,
  onRefreshCounts,
  setOrigins,
  setNotes,
}: Props) {
  const category = useAuthStore((state) => state.user?.category);
  const complete = (!hasDailyOrigins || missingDays(days).length === 0) && getDemographicAllocationStatus(demo, metrics.unique).isComplete && !metricsError && !isPeriodChanging;
  const submitted = Boolean(activeReport && ["Submitted", "Resubmitted", "Consolidated"].includes(activeReport.status));
  const waitingForUpload = activeReport?.syncStatus === "pending_cloud_sync";
  const steps = [
    { label: "Complete Visitor Details", done: complete },
    { label: "Review Report Form", done: submitted || (reviewed && complete) },
    { label: "Submit Report", done: submitted && !waitingForUpload },
  ];
  return (
    <section className="report-create-card" aria-label="Monthly DOT Visitor Report" aria-busy={isPeriodChanging}>
      <div className="report-information">
        <div className="report-information-left">
          <header>
            <h2>Monthly DOT Visitor Report</h2>
            <p>Create and manage your monthly tourism reports.</p>
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
              <dt>Tourism Period</dt>
              <dd>
                <CalendarDays aria-hidden="true" />
                <span>{formatReportingPeriodLabel(period)}</span>
              </dd>
            </div>
            <div>
              <dt>Tourism Attraction</dt>
              <dd>
                <Landmark aria-hidden="true" />
                <span>{category || "Not recorded"}</span>
              </dd>
            </div>
          </dl>
        </div>
        <div className="report-system-count" role="group" aria-label="Visitor counted by TANAW">
          <div>
            <h3>Visitor counted by TANAW</h3>
            <output aria-label="System unique visitor count">{isPeriodChanging ? "…" : metrics.counting || activeReport ? metrics.unique.toLocaleString() : "—"}</output>
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
          <VisitorDetails days={days} hasDailyOrigins={hasDailyOrigins} demo={demo} metrics={metrics} isReadOnly={isReadOnly || isPeriodChanging} period={period} setOrigins={setOrigins} />
        </section>
        <aside className="report-next-steps" aria-label="Next Steps">
          <h3>
            <Menu aria-hidden="true" />
            Next Steps
            {!isReadOnly && (metricsError || validationError) && (
              <InfoTooltip className="report-availability-hint" content={metricsError || validationError || ""} ariaLabel="Report availability">
                <Info size={17} aria-hidden="true" />
              </InfoTooltip>
            )}
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
              activeReport={activeReport}
              isReadOnly={isReadOnly}
              isPeriodChanging={isPeriodChanging}
              metricsError={metricsError}
              validationError={validationError}
              onSubmitPrompt={onSubmitPrompt}
            />
            {isReadOnly && (
              <p className="report-workflow-status">
                {waitingForUpload ? "Saved on this device · Upload pending" : activeReport?.status} · {activeReportId}
              </p>
            )}
            {!isReadOnly && (metricsError || validationError) && (
              <p className="sr-only" role="status">
                {metricsError || validationError}
              </p>
            )}
          </div>
        </aside>
      </div>
      {/* Keep supporting workflows compact; they no longer form stacked workspace cards. */}
      <div className="report-supporting-controls">
        <ReportDraftAlerts activeReport={activeReport} />
        {activeReport?.status === "Returned for Revision" && onRefreshCounts && (
          <button type="button" className="reports-text-button" disabled={isPeriodChanging} onClick={onRefreshCounts}>
            Refresh reconciled counts for this revision
          </button>
        )}
        <details>
          <summary>Report details, notes and camera evidence</summary>
          <div className="report-supporting-content">
            <CountingDetails metrics={metrics} />
            <SupplementaryNotes isReadOnly={isReadOnly} notes={notes} setNotes={setNotes} />
            <ReportAuditTrail activeReport={activeReport} />
          </div>
        </details>
      </div>
    </section>
  );
}
