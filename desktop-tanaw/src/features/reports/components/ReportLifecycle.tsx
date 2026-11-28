import { useId } from "react";
import { AlertTriangle, LifeBuoy, PencilLine, XCircle } from "lucide-react";
import { Button } from "../../../ui-kit";
import type { ReportRecord } from "../../../types/enterprise";
import type { SystemTimeFormat } from "../../../utils/date-time";
import { formatReportingPeriodLabel } from "../utils/reporting-period";
import { canReopenReport, isReturnedReport, reportReference, returnedHeadline, reportVersion, reviewState, sentConfirmationText, versionLabel, type ReportLifecycle } from "../model/report-lifecycle";

const DRAFT_SUBTITLE = "Create and manage your monthly tourism reports.";

/**
 * The line under the report title: for a sent month, when it was sent, its reference and where
 * Staff's review stands. It stays in place, so the confirmation lasts after the dialog closes.
 */
export function ReportStatusLine({ lifecycle, timeFormat }: { lifecycle: ReportLifecycle; timeFormat: SystemTimeFormat }) {
  if (lifecycle.kind === "draft") return <p>{DRAFT_SUBTITLE}</p>;
  if (lifecycle.kind === "correcting") {
    const text = ["Draft", versionLabel(lifecycle.version), `Corrects ${reportReference(lifecycle.previous)}`].filter(Boolean).join(" · ");
    return (
      <p className="report-status-line" data-lifecycle-focus tabIndex={-1}>
        <span className="report-status-line-text">{text}</span>
      </p>
    );
  }
  const review = reviewState(lifecycle.report);
  return (
    <p className="report-status-line" role="status" data-lifecycle-focus tabIndex={-1}>
      <span className="report-status-line-text">{sentConfirmationText(lifecycle.report, timeFormat)}</span>
      <span className="report-review-pill" data-tone={review.tone}>
        {review.text}
      </span>
    </p>
  );
}

type BannerProps = {
  lifecycle: ReportLifecycle;
  reports: ReportRecord[];
  timeFormat: SystemTimeFormat;
  /** The report being reopened right now, if any. */
  reopeningReportId: string | null;
  reopenIssue: string | null;
  onCorrect: (report: ReportRecord) => void;
  onAskForHelp: (report: ReportRecord) => void;
};

/**
 * What a returned or refused report needs, at the top of the report: who returned it and why, or
 * TANAW's reason for refusing it, and the way forward. While the month is corrected, the reason
 * stays in view above the draft.
 */
export function ReportLifecycleBanner({ lifecycle, reports, timeFormat, reopeningReportId, reopenIssue, onCorrect, onAskForHelp }: BannerProps) {
  const headingId = useId();
  if (lifecycle.kind === "returned") {
    const report = lifecycle.report;
    const canCorrect = canReopenReport(report, reports);
    return (
      <section className="report-lifecycle-banner" data-tone="returned" aria-labelledby={headingId}>
        <AlertTriangle className="report-lifecycle-icon" aria-hidden="true" />
        <div className="report-lifecycle-body">
          <h3 id={headingId} data-lifecycle-focus tabIndex={-1}>
            {returnedHeadline(report, timeFormat)}
          </h3>
          <Reason text={report.returnedReason} label="Staff's reason" missing="Staff did not add a reason. Call the City Tourism Office if you are not sure what to change." />
          <p className="report-lifecycle-meta">{referenceLine(report)}</p>
          {reopenIssue && (
            <p className="report-lifecycle-issue" role="alert">
              {reopenIssue}
            </p>
          )}
        </div>
        {canCorrect && (
          <div className="report-lifecycle-actions">
            <Button leadingIcon={<PencilLine size={16} aria-hidden="true" />} loading={reopeningReportId === report.id} onClick={() => onCorrect(report)}>
              Correct and send again
            </Button>
          </div>
        )}
      </section>
    );
  }
  if (lifecycle.kind === "upload_rejected") {
    const report = lifecycle.report;
    const canFix = canReopenReport(report, reports);
    return (
      <section className="report-lifecycle-banner" data-tone="rejected" aria-labelledby={headingId}>
        <XCircle className="report-lifecycle-icon" aria-hidden="true" />
        <div className="report-lifecycle-body">
          <h3 id={headingId} data-lifecycle-focus tabIndex={-1}>
            TANAW did not accept this report
          </h3>
          <p>It is saved on this computer, but LGU Staff have not received it. TANAW will not try to send it again on its own.</p>
          <Reason text={report.rejectionReason} label="Message from TANAW" missing="TANAW did not say why." />
          <p className="report-lifecycle-meta">{referenceLine(report)}</p>
          {reopenIssue && (
            <p className="report-lifecycle-issue" role="alert">
              {reopenIssue}
            </p>
          )}
        </div>
        <div className="report-lifecycle-actions">
          {canFix && (
            <Button leadingIcon={<PencilLine size={16} aria-hidden="true" />} loading={reopeningReportId === report.id} onClick={() => onCorrect(report)}>
              Fix and send again
            </Button>
          )}
          <Button variant="secondary" leadingIcon={<LifeBuoy size={16} aria-hidden="true" />} onClick={() => onAskForHelp(report)}>
            Ask IT for help
          </Button>
        </div>
      </section>
    );
  }
  if (lifecycle.kind === "correcting") {
    const { previous, cause, version } = lifecycle;
    const month = formatReportingPeriodLabel(previous.period ?? previous.date);
    const returned = cause === "returned";
    return (
      <section className="report-lifecycle-banner" data-tone={returned ? "returned" : "rejected"} data-state="correcting" aria-labelledby={headingId}>
        <PencilLine className="report-lifecycle-icon" aria-hidden="true" />
        <div className="report-lifecycle-body">
          <h3 id={headingId} data-lifecycle-focus tabIndex={-1}>
            {returned ? `You are correcting the ${month} report` : `You are fixing the ${month} report TANAW did not accept`}
          </h3>
          <p>{returned ? `${returnedHeadline(previous, timeFormat)}.` : `TANAW did not accept ${reportReference(previous)}.`}</p>
          {returned ? (
            <Reason text={previous.returnedReason} label="Staff's reason" missing="Staff did not add a reason." />
          ) : (
            <Reason text={previous.rejectionReason} label="Message from TANAW" missing="TANAW did not say why." />
          )}
          <p className="report-lifecycle-meta">
            {`It starts from ${reportReference(previous)}'s figures. When it is right, submit it again`}
            {versionLabel(version) ? `; it will be sent as version ${version}.` : "."}
          </p>
        </div>
      </section>
    );
  }
  return null;
}

/**
 * Other months whose report waits on the person (returned, or refused by TANAW), so a returned
 * report is found from whichever month is open.
 */
export function ReportsNeedingAction({ reports, onOpen }: { reports: ReportRecord[]; onOpen: (report: ReportRecord) => void }) {
  if (!reports.length) return null;
  return (
    <ul className="report-attention-list" aria-label="Reports that need your attention">
      {reports.map((report) => {
        const month = formatReportingPeriodLabel(report.period ?? report.date);
        const returned = isReturnedReport(report);
        return (
          <li key={report.id} data-tone={returned ? "returned" : "rejected"}>
            {returned ? <AlertTriangle aria-hidden="true" /> : <XCircle aria-hidden="true" />}
            <span>{returned ? `Your ${month} report was returned for correction.` : `TANAW did not accept your ${month} report.`}</span>
            <Button variant="secondary" size="sm" onClick={() => onOpen(report)}>
              Open {month}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Reason({ text, label, missing }: { text: string | null | undefined; label: string; missing: string }) {
  const reason = text?.trim();
  if (!reason) return <p>{missing}</p>;
  return (
    <figure className="report-lifecycle-reason">
      <figcaption>{label}</figcaption>
      <blockquote>{reason}</blockquote>
    </figure>
  );
}

function referenceLine(report: ReportRecord) {
  return [`Reference ${reportReference(report)}`, versionLabel(reportVersion(report))].filter(Boolean).join(" · ");
}
