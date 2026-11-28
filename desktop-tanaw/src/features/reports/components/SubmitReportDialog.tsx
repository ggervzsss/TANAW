import { Send } from "lucide-react";
import { Alert, Button, Dialog } from "../../../ui-kit";
import type { DemoBreakdown, Metrics } from "../../../types/enterprise";
import type { ReportDay } from "../model/daily-origins";
import { originSplit, reportDayCoverage, submitDialogTitle, versionLabel } from "../model/report-lifecycle";
import type { ReportSubmissionIssue } from "../model/report-workspace";
import { formatReportingPeriodLabel } from "../utils/reporting-period";

type SubmitReportDialogProps = {
  period: string;
  metrics: Metrics;
  demo: DemoBreakdown;
  days: ReportDay[];
  /** Set when the month's draft corrects a returned or refused version. */
  correction?: { version: number; previousId: string } | null;
  isSubmitting: boolean;
  /** Why the last attempt failed; shown above the actions. */
  issue?: ReportSubmissionIssue | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * Asks before the month's report goes to the LGU, with the figures it will carry and what
 * happens next. Cancel takes focus first; while the report is being sent the dialog stays open.
 */
export function SubmitReportDialog({ period, metrics, demo, days, correction = null, isSubmitting, issue = null, onCancel, onConfirm }: SubmitReportDialogProps) {
  const origins = originSplit(demo);
  const coverage = reportDayCoverage(days);
  const version = correction ? versionLabel(correction.version) : null;
  const originRows: Array<[string, number]> = [
    ["This city", origins.thisCity],
    ["Other cities in the province", origins.otherCities],
    ["Other provinces", origins.otherProvinces],
    ["Foreign", origins.foreign],
  ];
  return (
    <Dialog
      size="sm"
      title={submitDialogTitle(period, Boolean(correction))}
      description={correction ? `It corrects ${correction.previousId}${version ? ` and goes as ${version.toLowerCase()}` : ""}.` : undefined}
      onClose={onCancel}
      dismissible={!isSubmitting}
      closeOnBackdrop={!isSubmitting}
      initialFocus="[data-submit-cancel]"
      className="report-submit-dialog"
      footer={
        <>
          <Button variant="secondary" data-submit-cancel onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button leadingIcon={<Send size={16} aria-hidden="true" />} loading={isSubmitting} onClick={() => void onConfirm()}>
            {issue?.canRetry ? "Try again" : "Send report"}
          </Button>
        </>
      }
    >
      <dl className="report-submit-summary" aria-label="What this report carries">
        <div>
          <dt>Reporting period</dt>
          <dd>{formatReportingPeriodLabel(period)}</dd>
        </div>
        <div>
          <dt>Visitors counted</dt>
          <dd>{metrics.unique.toLocaleString()}</dd>
        </div>
        {metrics.unique > 0 && (
          <div className="report-submit-origins">
            <dt>Where visitors came from</dt>
            <dd>
              <ul>
                {originRows.map(([label, value]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span>{value.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {coverage.total > 0 && (
          <div>
            <dt>Days included</dt>
            <dd>
              {coverage.total.toLocaleString()} days · {coverage.counted.toLocaleString()} with visitors counted
            </dd>
          </div>
        )}
        {version && (
          <div>
            <dt>Version</dt>
            <dd>{version}</dd>
          </div>
        )}
      </dl>
      <p className="report-submit-copy">After you send it, you can't edit this report. If something is wrong, LGU Staff can return it to you for correction.</p>
      <p className="report-submit-copy">
        <strong>What happens next:</strong> Staff in the City Tourism Office will review it.
      </p>
      {issue && (
        <Alert tone="danger" className="report-submit-issue">
          {issue.message}
        </Alert>
      )}
    </Dialog>
  );
}
