import { ArrowRight, Check, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReportRecord } from "../../../types/enterprise";
import { routePaths } from "../../../app/router/routePaths";

type LedgerProps = {
  reports: ReportRecord[];
  enterpriseName: string;
  /** True until the first list of saved reports arrives. */
  loading?: boolean;
  onPreviewReport: (report: ReportRecord) => void;
};

/**
 * Recent Reports runs the full width under Visitor Traffic and Monitored Locations and shows only
 * the latest report, so it never scrolls; "View all" opens every report in Reports.
 */
export function SubmissionLedgerPreview({ reports, enterpriseName, loading = false, onPreviewReport }: LedgerProps) {
  const entries = reports.slice(0, 1).map((report) => ({
    id: report.id,
    title: `Tourism Report, ${report.date}`,
    period: report.period ?? report.date,
    sentTo: report.syncStatus === "pending" ? "Waiting to sync" : "LGU",
    date: report.date,
    status: report.status,
    preview: () => onPreviewReport(report),
  }));
  return (
    <section className="dash-reports" aria-labelledby="dash-reports-title">
      <div className="dash-section-head dash-section-head-row">
        <div>
          <h2 id="dash-reports-title" className="dash-section-title">
            Recent Reports
          </h2>
          <p className="dash-section-sub">
            Latest tourism report from <b>{enterpriseName}</b> site
          </p>
        </div>
        <Link to={routePaths.enterpriseReports} className="dash-link">
          View all <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </div>
      {loading ? (
        <div className="dash-report-loading" aria-busy="true" aria-label="Loading recent reports">
          {[0].map((row) => (
            <div key={row} className="dash-report-row dash-report-row-skeleton">
              <span className="dash-report-name">
                <span className="design-skeleton dash-report-icon" />
                <span className="design-skeleton dash-line-skeleton" style={{ width: "70%" }} />
              </span>
              <span className="design-skeleton dash-line-skeleton" />
              <span className="design-skeleton dash-line-skeleton" />
              <span className="design-skeleton dash-line-skeleton" style={{ marginLeft: "auto", width: "60%" }} />
            </div>
          ))}
        </div>
      ) : entries.length ? (
        <>
          <div className="dash-report-columns" aria-hidden="true">
            <span>Report</span>
            <span>Sent to</span>
            <span>Date</span>
            <span>Status</span>
          </div>
          <div className="dash-report-list" role="region" aria-label="Recent report list">
            {entries.map((entry, index) => (
              <button
                key={entry.id + index}
                type="button"
                className="dash-report-row"
                onClick={entry.preview}
                aria-label={`Tourism Report for ${entry.period}, sent to ${entry.sentTo} on ${entry.date}, ${entry.status}`}
              >
                <span className="dash-report-name">
                  <span className="dash-report-icon" aria-hidden="true">
                    <FileText size={18} />
                  </span>
                  <strong>{entry.title}</strong>
                </span>
                <span className="dash-report-cell">{entry.sentTo}</span>
                <span className="dash-report-cell">{entry.date}</span>
                <span className="dash-report-status">
                  <span className="dash-badge">
                    <Check size={13} aria-hidden="true" />
                    {entry.status}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="dash-report-empty" role="status">
          Submitted tourism reports will appear here.
        </p>
      )}
    </section>
  );
}
